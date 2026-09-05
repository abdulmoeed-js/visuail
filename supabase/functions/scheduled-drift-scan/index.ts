// Daily background drift scan for Pro/Team projects, triggered by pg_cron
// (see the schedule-drift-scan migration). Not user-facing and not
// individually authenticated -- verify_jwt is off, and the only auth check
// is the caller presenting the project's own service-role key, which only
// the cron job (running inside this Supabase project) knows.
//
// Detection only. An unattended scan must never silently overwrite a
// project's live canvases -- there's no one present to review a conflict
// against a manual edit. Drift found here is recorded in drift_alerts;
// applying it still goes through the existing interactive "Re-check for
// drift" button, which does the full reconcile-with-manual-edits flow.
//
// Cost/correctness gate: a project is only re-extracted when its sources
// have changed since the last scan (hash of the source texts stored on the
// project row). Re-extracting identical text every night was the dominant
// API cost (~$0.64/source/month) and, because LLM output isn't perfectly
// deterministic, it surfaced phrasing variance as false "drift" alerts.
// "Drift" means the source of truth moved; unchanged sources can't drift.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { ANTHROPIC_MODEL, callAnthropicExtraction, MIN_TEXT_CHARS, type ExtractionResult, type ExtractionUsage } from "../_shared/extraction.ts";
import { diffChangedTexts, mergeForScan } from "../_shared/model-diff.ts";
import { sendSlackDrift, sendEmailDrift } from "../_shared/notify.ts";

interface StoredSource { label: string; text: string }
interface StoredCanvas { kind: "process" | "bmc"; model: Record<string, unknown> }
interface ProjectRow {
  id: string; name: string; org_id: string; created_by: string; kinds: string[]; sources: StoredSource[];
  drift_scan_sources_hash: string | null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Deterministic fingerprint of what the scan would actually send to the
 *  model. Order matters (a reordered source list re-scans), labels matter
 *  (they name the source in alerts). */
function sourcesFingerprint(sources: StoredSource[]): Promise<string> {
  return sha256Hex(JSON.stringify(sources.map((s) => [s.label, s.text])));
}

const EMPTY_USAGE: ExtractionUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

Deno.serve(async (req: Request) => {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    return new Response(JSON.stringify({ error: "Not authorized." }), { status: 401 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing ANTHROPIC_API_KEY." }), { status: 500 });
  }

  const { data: orgs, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .in("tier", ["pro", "team"]);
  if (orgErr) return new Response(JSON.stringify({ error: orgErr.message }), { status: 500 });
  const orgIds = (orgs ?? []).map((o) => o.id);
  if (orgIds.length === 0) return new Response(JSON.stringify({ scanned: 0, skipped: 0, drifted: 0 }));

  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, name, org_id, created_by, kinds, sources, drift_scan_sources_hash")
    .in("org_id", orgIds);
  if (projErr) return new Response(JSON.stringify({ error: projErr.message }), { status: 500 });

  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "https://id-preview--af93f212-53f2-471a-b865-406fc0935f89.lovable.app";
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  let scanned = 0;
  let skipped = 0;
  let drifted = 0;

  for (const project of (projects ?? []) as ProjectRow[]) {
    if (!project.sources || project.sources.length === 0) continue;
    if (!project.kinds || project.kinds.length === 0) continue;

    const { data: snapshots } = await supabase
      .from("project_snapshots")
      .select("canvases")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const baseline = snapshots?.[0]?.canvases as StoredCanvas[] | undefined;
    if (!baseline || baseline.length === 0) continue; // nothing to diff against yet

    // Lever 1: nothing to detect if the sources are byte-identical to the
    // last scan. First scan of a project (no stored hash) always runs.
    const fingerprint = await sourcesFingerprint(project.sources);
    if (project.drift_scan_sources_hash === fingerprint) {
      skipped++;
      continue;
    }

    scanned++;
    const summary: { kind: string; changed: string[]; added: string[]; removed: string[] }[] = [];
    const usage: ExtractionUsage = { ...EMPTY_USAGE };

    try {
      // Lever 2: prompt-cache friendly fan-out. A cache entry becomes readable
      // only after the first response starts, so N parallel first-requests
      // would all pay the cache write. Extract one source alone to warm the
      // shared prefix, then the rest in parallel read it at 0.1x.
      const eligible = project.sources.map((s, i) => ({ s, i })).filter(({ s }) => s.text.trim().length >= MIN_TEXT_CHARS);
      const perSource: ExtractionResult[][] = project.sources.map(() => []);
      const run = async ({ s, i }: { s: StoredSource; i: number }) => {
        const r = await callAnthropicExtraction(s.text, project.kinds, apiKey);
        perSource[i] = r.results;
        usage.input_tokens += r.usage.input_tokens;
        usage.output_tokens += r.usage.output_tokens;
        usage.cache_creation_input_tokens += r.usage.cache_creation_input_tokens;
        usage.cache_read_input_tokens += r.usage.cache_read_input_tokens;
      };
      if (eligible.length > 0) {
        await run(eligible[0]);
        await Promise.all(eligible.slice(1).map(run));
      }

      // Attributed to the creator (the column is NOT NULL and there's no
      // system user), but tagged source='scan' so extract-artifact's
      // interactive rate limit ignores these rows.
      await supabase.from("extraction_log").insert({
        user_id: project.created_by, source: "scan", model: ANTHROPIC_MODEL, ...usage,
      });

      for (const kind of project.kinds) {
        const modelsForKind = perSource.flatMap((r) => r.filter((x) => x.kind === kind).map((x) => x.model));
        const merged = mergeForScan(modelsForKind as never[]);
        const baselineModel = baseline.find((c) => c.kind === kind)?.model;
        if (!merged || !baselineModel) continue;
        const diff = diffChangedTexts(baselineModel as never, merged as never);
        if (diff.changed.length + diff.added.length + diff.removed.length > 0) {
          summary.push({ kind, ...diff });
        }
      }
    } catch (e) {
      // Hash deliberately NOT recorded on failure, so tomorrow's run retries.
      console.error(`[scheduled-drift-scan] project ${project.id} failed`, e);
      continue;
    }

    // Record what was scanned so an unchanged project is skipped tomorrow.
    await supabase.from("projects")
      .update({ drift_scan_sources_hash: fingerprint, drift_scan_at: new Date().toISOString() })
      .eq("id", project.id);

    if (summary.length > 0) {
      drifted++;
      await supabase.from("drift_alerts").insert({ project_id: project.id, drifted_summary: summary });

      const itemCount = summary.reduce((n, s) => n + s.changed.length + s.added.length + s.removed.length, 0);
      const [{ data: slack }, { data: org }] = await Promise.all([
        supabase.from("org_slack_integration").select("webhook_url").eq("org_id", project.org_id).maybeSingle(),
        supabase.from("organizations").select("notification_email").eq("id", project.org_id).single(),
      ]);
      // Best-effort -- a failed notification doesn't undo the already-recorded alert.
      if (slack?.webhook_url) {
        try { await sendSlackDrift(slack.webhook_url, project.name, itemCount, appOrigin, project.id); }
        catch (e) { console.error(`[scheduled-drift-scan] Slack notify failed for ${project.id}`, e); }
      }
      if (resendApiKey && org?.notification_email) {
        try { await sendEmailDrift(resendApiKey, org.notification_email, project.name, itemCount, appOrigin, project.id); }
        catch (e) { console.error(`[scheduled-drift-scan] Email notify failed for ${project.id}`, e); }
      }
    }
  }

  return new Response(JSON.stringify({ scanned, skipped, drifted }), { headers: { "content-type": "application/json" } });
});
