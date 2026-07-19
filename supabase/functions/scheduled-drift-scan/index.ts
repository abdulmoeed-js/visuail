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

import { createClient } from "jsr:@supabase/supabase-js@2";
import { callAnthropicExtraction, MIN_TEXT_CHARS } from "../_shared/extraction.ts";
import { diffChangedTexts, mergeForScan } from "../_shared/model-diff.ts";

interface StoredSource { label: string; text: string }
interface StoredCanvas { kind: "process" | "bmc"; model: Record<string, unknown> }
interface ProjectRow {
  id: string; created_by: string; kinds: string[]; sources: StoredSource[];
}

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
  if (orgIds.length === 0) return new Response(JSON.stringify({ scanned: 0, drifted: 0 }));

  const { data: projects, error: projErr } = await supabase
    .from("projects")
    .select("id, created_by, kinds, sources")
    .in("org_id", orgIds);
  if (projErr) return new Response(JSON.stringify({ error: projErr.message }), { status: 500 });

  let scanned = 0;
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

    scanned++;
    const summary: { kind: string; changed: string[]; added: string[]; removed: string[] }[] = [];

    try {
      const perSource = await Promise.all(
        project.sources.map((s) =>
          s.text.trim().length >= MIN_TEXT_CHARS
            ? callAnthropicExtraction(s.text, project.kinds, apiKey)
            : Promise.resolve([]),
        ),
      );
      await supabase.from("extraction_log").insert({ user_id: project.created_by });

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
      console.error(`[scheduled-drift-scan] project ${project.id} failed`, e);
      continue;
    }

    if (summary.length > 0) {
      drifted++;
      await supabase.from("drift_alerts").insert({ project_id: project.id, drifted_summary: summary });
    }
  }

  return new Response(JSON.stringify({ scanned, drifted }), { headers: { "content-type": "application/json" } });
});
