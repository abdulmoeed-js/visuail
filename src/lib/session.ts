// Real session + project persistence, backed by Supabase Auth (magic link)
// and the `profiles` / `organizations` / `organization_members` / `projects`
// tables. A user can belong to multiple orgs (their personal org, plus any
// Team org they're invited into); `currentOrgId` tracks which one is active
// in this browser tab, persisted to localStorage per-user so it survives
// reloads. Reads stay a flat `Session` object; writes are async functions on
// `sessionStore` that notify every mounted `useSession()` instance to
// refetch -- the same cross-component refresh pattern the app has used
// since the localStorage-only version.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ArtifactModel } from "@/data/samples";
import type { ArtifactKind } from "@/lib/extract";

export type Tier = "free" | "pro" | "team";
export type OrgRole = "owner" | "member";

export interface Org {
  id: string;
  name: string;
  tier: Tier;
  isPersonal: boolean;
  role: OrgRole;
}

export interface StoredSource {
  label: string;
  text: string;
  origin: "paste" | "upload" | "scratch";
  filename?: string;
}

export interface StoredCanvas {
  kind: ArtifactKind;
  model: ArtifactModel;
}

export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  kinds: ArtifactKind[];
  sources: StoredSource[];
  canvases: StoredCanvas[];
  createdAt: number;
  updatedAt: number;
  fromScratch?: boolean;
}

export interface OrgMember {
  userId: string;
  email: string;
  role: OrgRole;
  joinedAt: number;
}

export interface PendingInvite {
  id: string;
  email: string;
  createdAt: number;
}

export interface ShareLink {
  id: string;
  token: string;
  includeSources: boolean;
  createdAt: number;
  revoked: boolean;
}

/** What the public, unauthenticated /share/$token route reads via get_shared_project(). */
export interface SharedProject {
  id: string;
  name: string;
  description?: string;
  kinds: ArtifactKind[];
  canvases: StoredCanvas[];
  sources: StoredSource[];
}

export interface ProjectComment {
  id: string;
  authorEmail: string;
  authorId: string;
  body: string;
  createdAt: number;
  /** null = the project-wide thread; a value anchors this comment to one canvas item. */
  itemId: string | null;
}

export interface DriftAlert {
  id: string;
  detectedAt: number;
  summary: { kind: string; changed: string[]; added: string[]; removed: string[] }[];
}

export type SnapshotTrigger = "manual_save" | "source_added" | "drift_recheck" | "manual_edit";

/** Lightweight summary for the history list -- no canvases payload, so listing stays cheap. */
export interface SnapshotSummary {
  id: string;
  trigger: SnapshotTrigger;
  createdAt: number;
  createdByEmail?: string;
}

export interface Session {
  signedIn: boolean;
  loading: boolean;
  email?: string;
  userId?: string;
  orgs: Org[];
  currentOrgId?: string;
  /** Tier of the currently active org -- what the rest of the app should gate on. */
  tier: Tier;
  projects: StoredProject[];
  switchOrg: (orgId: string) => void;
}

const EVENT = "visuail:session";
const FREE_PROJECT_CAP = 2;
export const FREE_LIMIT = FREE_PROJECT_CAP;

function notify() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

const activeOrgKey = (userId: string) => `visuail:activeOrg:${userId}`;

function getStoredOrgId(userId: string): string | null {
  try {
    return localStorage.getItem(activeOrgKey(userId));
  } catch {
    return null;
  }
}

function setStoredOrgId(userId: string, orgId: string) {
  try {
    localStorage.setItem(activeOrgKey(userId), orgId);
  } catch {
    // ignore -- private browsing / storage disabled, falls back to session-only state
  }
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  kinds: string[];
  sources: StoredSource[];
  canvases: StoredCanvas[];
  from_scratch: boolean;
  created_at: string;
  updated_at: string;
}

function fromRow(row: ProjectRow): StoredProject {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    kinds: row.kinds as ArtifactKind[],
    sources: row.sources ?? [],
    canvases: row.canvases ?? [],
    fromScratch: row.from_scratch,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

interface OrgMemberRow {
  role: OrgRole;
  organizations: { id: string; name: string; tier: Tier; is_personal: boolean } | null;
}

async function fetchOrgs(userId: string): Promise<Org[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations(id, name, tier, is_personal)")
    .eq("user_id", userId);
  if (error) throw error;
  return ((data as unknown as OrgMemberRow[] | null) ?? [])
    .filter((r) => r.organizations)
    .map((r) => ({
      id: r.organizations!.id,
      name: r.organizations!.name,
      tier: r.organizations!.tier,
      isPersonal: r.organizations!.is_personal,
      role: r.role,
    }));
}

/** Picks the active org: prior stored choice if it's still valid, else the personal org, else the first available. */
function resolveActiveOrgId(userId: string, orgs: Org[]): string | undefined {
  if (orgs.length === 0) return undefined;
  const stored = getStoredOrgId(userId);
  if (stored && orgs.some((o) => o.id === stored)) return stored;
  return (orgs.find((o) => o.isPersonal) ?? orgs[0]).id;
}

async function fetchProjects(orgId: string): Promise<StoredProject[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data as ProjectRow[] | null) ?? []).map(fromRow);
}

// Debounced writer for high-frequency updates (canvas autosave on every
// edit) -- merges rapid patches into one write instead of one network call
// per keystroke/drag frame.
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPatches = new Map<string, Partial<StoredProject>>();

export const sessionStore = {
  async sendMagicLink(email: string): Promise<void> {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) throw error;
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
    notify();
  },

  async setTier(orgId: string, tier: Tier): Promise<void> {
    const { error } = await supabase
      .from("organizations")
      .update({ tier, updated_at: new Date().toISOString() })
      .eq("id", orgId);
    if (error) throw error;
    notify();
  },

  /** Pure check against already-loaded session data -- the database trigger
   *  is the real enforcement; this is only for showing an upgrade prompt
   *  before attempting an insert that would be rejected anyway. */
  canCreateProject(currentCount: number, tier: Tier): { ok: boolean; reason?: string } {
    if (tier !== "free") return { ok: true };
    if (currentCount >= FREE_PROJECT_CAP) {
      return {
        ok: false,
        reason: `Free tier is limited to ${FREE_PROJECT_CAP} projects. Upgrade to Pro for unlimited.`,
      };
    }
    return { ok: true };
  },

  async createProject(
    orgId: string,
    createdBy: string,
    p: Omit<StoredProject, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoredProject> {
    const { data, error } = await supabase
      .from("projects")
      .insert({
        org_id: orgId,
        created_by: createdBy,
        name: p.name,
        description: p.description ?? null,
        kinds: p.kinds,
        sources: p.sources,
        canvases: p.canvases,
        from_scratch: p.fromScratch ?? false,
      })
      .select()
      .single();
    if (error) throw error;
    notify();
    return fromRow(data as ProjectRow);
  },

  async updateProject(id: string, patch: Partial<StoredProject>): Promise<void> {
    const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.description !== undefined) dbPatch.description = patch.description;
    if (patch.kinds !== undefined) dbPatch.kinds = patch.kinds;
    if (patch.sources !== undefined) dbPatch.sources = patch.sources;
    if (patch.canvases !== undefined) dbPatch.canvases = patch.canvases;
    if (patch.fromScratch !== undefined) dbPatch.from_scratch = patch.fromScratch;
    const { error } = await supabase.from("projects").update(dbPatch).eq("id", id);
    if (error) throw error;
    notify();
  },

  /** Fire-and-forget, coalesced write for frequent callers (canvas autosave). */
  updateProjectDebounced(id: string, patch: Partial<StoredProject>, delayMs = 800): void {
    pendingPatches.set(id, { ...(pendingPatches.get(id) ?? {}), ...patch });
    const existing = debounceTimers.get(id);
    if (existing) clearTimeout(existing);
    debounceTimers.set(
      id,
      setTimeout(() => {
        const toSend = pendingPatches.get(id);
        pendingPatches.delete(id);
        debounceTimers.delete(id);
        if (toSend) {
          sessionStore.updateProject(id, toSend).catch((e) => {
            // eslint-disable-next-line no-console
            console.error("[session] debounced project update failed", e);
          });
        }
      }, delayMs),
    );
  },

  async deleteProject(id: string): Promise<void> {
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
    notify();
  },

  /** Checkpoint the current canvases. Called on meaningful events (creation,
   *  re-extraction, an explicit "Save version" click) -- never on every
   *  autosave tick, or this table would grow one row per keystroke. */
  async saveSnapshot(
    projectId: string,
    canvases: StoredCanvas[],
    trigger: SnapshotTrigger,
    createdBy: string,
  ): Promise<void> {
    const { error } = await supabase
      .from("project_snapshots")
      .insert({ project_id: projectId, canvases, trigger, created_by: createdBy });
    if (error) throw error;
  },

  async listSnapshots(projectId: string): Promise<SnapshotSummary[]> {
    const { data, error } = await supabase
      .from("project_snapshots")
      .select("id, trigger, created_at, profiles(email)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data as unknown as { id: string; trigger: SnapshotTrigger; created_at: string; profiles: { email: string } | null }[] | null) ?? [])
      .map((r) => ({
        id: r.id,
        trigger: r.trigger,
        createdAt: new Date(r.created_at).getTime(),
        createdByEmail: r.profiles?.email,
      }));
  },

  /** Fetches one snapshot's full canvases -- kept separate from listSnapshots so the list stays cheap. */
  async getSnapshotCanvases(snapshotId: string): Promise<StoredCanvas[]> {
    const { data, error } = await supabase
      .from("project_snapshots")
      .select("canvases")
      .eq("id", snapshotId)
      .single();
    if (error) throw error;
    return (data as { canvases: StoredCanvas[] }).canvases;
  },

  /** Full snapshot history (canvases included) oldest-first, for the audit
   *  trail (src/lib/audit.ts) -- the only consumer that needs every
   *  snapshot's full payload at once rather than one at a time. */
  async listSnapshotsWithCanvases(
    projectId: string,
  ): Promise<{ canvases: StoredCanvas[]; trigger: SnapshotTrigger; createdAt: number }[]> {
    const { data, error } = await supabase
      .from("project_snapshots")
      .select("canvases, trigger, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data as { canvases: StoredCanvas[]; trigger: SnapshotTrigger; created_at: string }[] | null) ?? [])
      .map((r) => ({ canvases: r.canvases, trigger: r.trigger, createdAt: new Date(r.created_at).getTime() }));
  },

  /** Unnotified drift_alerts rows written by the scheduled background scan
   *  (supabase/functions/scheduled-drift-scan) -- detection only, never
   *  applied to the canvas automatically. */
  async listDriftAlerts(projectId: string): Promise<DriftAlert[]> {
    const { data, error } = await supabase
      .from("drift_alerts")
      .select("id, detected_at, drifted_summary")
      .eq("project_id", projectId)
      .is("notified_at", null)
      .order("detected_at", { ascending: false });
    if (error) throw error;
    return ((data as { id: string; detected_at: string; drifted_summary: DriftAlert["summary"] }[] | null) ?? [])
      .map((r) => ({ id: r.id, detectedAt: new Date(r.detected_at).getTime(), summary: r.drifted_summary }));
  },

  async dismissDriftAlert(id: string): Promise<void> {
    const { error } = await supabase
      .from("drift_alerts")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    notify();
  },

  async listMembers(orgId: string): Promise<OrgMember[]> {
    const { data, error } = await supabase
      .from("organization_members")
      .select("user_id, role, joined_at, profiles(email)")
      .eq("org_id", orgId)
      .order("joined_at", { ascending: true });
    if (error) throw error;
    return ((data as unknown as { user_id: string; role: OrgRole; joined_at: string; profiles: { email: string } | null }[] | null) ?? [])
      .map((r) => ({ userId: r.user_id, email: r.profiles?.email ?? "(unknown)", role: r.role, joinedAt: new Date(r.joined_at).getTime() }));
  },

  async listPendingInvites(orgId: string): Promise<PendingInvite[]> {
    const { data, error } = await supabase
      .from("organization_invites")
      .select("id, email, created_at")
      .eq("org_id", orgId)
      .is("accepted_at", null)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return ((data as { id: string; email: string; created_at: string }[] | null) ?? [])
      .map((r) => ({ id: r.id, email: r.email, createdAt: new Date(r.created_at).getTime() }));
  },

  async inviteMember(orgId: string, email: string, invitedBy: string): Promise<void> {
    const { error } = await supabase
      .from("organization_invites")
      .insert({ org_id: orgId, email: email.trim().toLowerCase(), invited_by: invitedBy });
    if (error) throw error;
    notify();
  },

  async cancelInvite(inviteId: string): Promise<void> {
    const { error } = await supabase.from("organization_invites").delete().eq("id", inviteId);
    if (error) throw error;
    notify();
  },

  /** Owner-only -- enforced by the org_members_owner_manages RLS policy, this is just the client call. */
  async removeMember(orgId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from("organization_members")
      .delete()
      .eq("org_id", orgId)
      .eq("user_id", userId);
    if (error) throw error;
    notify();
  },

  /** itemId omitted = the project-wide thread. Pass it to scope to one canvas item. */
  async listComments(projectId: string, itemId?: string | null): Promise<ProjectComment[]> {
    let query = supabase
      .from("project_comments")
      .select("id, body, created_at, user_id, item_id, profiles(email)")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    query = itemId === undefined ? query : itemId === null ? query.is("item_id", null) : query.eq("item_id", itemId);
    const { data, error } = await query;
    if (error) throw error;
    return ((data as unknown as { id: string; body: string; created_at: string; user_id: string; item_id: string | null; profiles: { email: string } | null }[] | null) ?? [])
      .map((r) => ({
        id: r.id, body: r.body, authorId: r.user_id, itemId: r.item_id,
        authorEmail: r.profiles?.email ?? "(unknown)",
        createdAt: new Date(r.created_at).getTime(),
      }));
  },

  /** Comment counts per item_id for a whole project, for badge display -- excludes the project-wide thread (item_id null). */
  async listCommentCounts(projectId: string): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from("project_comments")
      .select("item_id")
      .eq("project_id", projectId)
      .not("item_id", "is", null);
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const row of (data as { item_id: string }[] | null) ?? []) {
      counts[row.item_id] = (counts[row.item_id] ?? 0) + 1;
    }
    return counts;
  },

  async addComment(projectId: string, userId: string, body: string, itemId: string | null = null): Promise<void> {
    const { error } = await supabase
      .from("project_comments")
      .insert({ project_id: projectId, user_id: userId, body: body.trim(), item_id: itemId });
    if (error) throw error;
    notify();
  },

  async deleteComment(commentId: string): Promise<void> {
    const { error } = await supabase.from("project_comments").delete().eq("id", commentId);
    if (error) throw error;
    notify();
  },

  async listShareLinks(projectId: string): Promise<ShareLink[]> {
    const { data, error } = await supabase
      .from("project_share_links")
      .select("id, token, include_sources, created_at, revoked_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data as { id: string; token: string; include_sources: boolean; created_at: string; revoked_at: string | null }[] | null) ?? [])
      .map((r) => ({
        id: r.id, token: r.token, includeSources: r.include_sources,
        createdAt: new Date(r.created_at).getTime(), revoked: r.revoked_at !== null,
      }));
  },

  async createShareLink(projectId: string, createdBy: string, includeSources: boolean): Promise<ShareLink> {
    // 256 bits of randomness -- unguessable, and this is the only thing
    // standing between "anyone with the link" and the project's data, since
    // get_shared_project() intentionally has no other access check.
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { data, error } = await supabase
      .from("project_share_links")
      .insert({ project_id: projectId, token, created_by: createdBy, include_sources: includeSources })
      .select()
      .single();
    if (error) throw error;
    const row = data as { id: string; token: string; include_sources: boolean; created_at: string };
    notify();
    return { id: row.id, token: row.token, includeSources: row.include_sources, createdAt: new Date(row.created_at).getTime(), revoked: false };
  },

  async revokeShareLink(id: string): Promise<void> {
    const { error } = await supabase
      .from("project_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    notify();
  },
};

/** Public, unauthenticated read for the /share/$token route. Returns null for
 *  a missing or revoked token -- the route renders a "link no longer active"
 *  state rather than a raw error either way. */
export async function getSharedProject(token: string): Promise<SharedProject | null> {
  const { data, error } = await supabase.rpc("get_shared_project", { share_token: token });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as {
    id: string; name: string; description: string | null; kinds: string[]; canvases: StoredCanvas[]; sources: StoredSource[];
  };
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    kinds: row.kinds as ArtifactKind[],
    canvases: row.canvases ?? [],
    sources: row.sources ?? [],
  };
}

export function useSession(): Session {
  const [auth, setAuth] = useState<{ userId?: string; email?: string; initializing: boolean }>({
    initializing: true,
  });
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    // Resolves any pending Team invites for this email into real
    // memberships before the org list loads -- someone invited while they
    // already had an account never re-triggers handle_new_user(), so this
    // is the only place that catches that case. Harmless no-op otherwise.
    const settle = async (u: { id: string; email?: string } | undefined) => {
      if (u) {
        try { await supabase.rpc("accept_pending_invites"); } catch { /* best-effort */ }
      }
      setAuth({ userId: u?.id, email: u?.email, initializing: false });
    };
    supabase.auth.getSession().then(({ data: s }) => settle(s.session?.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { settle(s?.user); });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refetch = useCallback(() => {
    if (!auth.userId) {
      setOrgs([]);
      setCurrentOrgId(undefined);
      setProjects([]);
      return;
    }
    const userId = auth.userId;
    setDataLoading(true);
    fetchOrgs(userId)
      .then(async (fetchedOrgs) => {
        setOrgs(fetchedOrgs);
        const activeId = resolveActiveOrgId(userId, fetchedOrgs);
        setCurrentOrgId(activeId);
        if (activeId) {
          setStoredOrgId(userId, activeId);
          setProjects(await fetchProjects(activeId));
        } else {
          setProjects([]);
        }
      })
      .finally(() => setDataLoading(false));
  }, [auth.userId]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    window.addEventListener(EVENT, refetch);
    return () => window.removeEventListener(EVENT, refetch);
  }, [refetch]);

  const switchOrg = useCallback((orgId: string) => {
    if (!auth.userId || orgId === currentOrgId) return;
    setStoredOrgId(auth.userId, orgId);
    setCurrentOrgId(orgId);
    setDataLoading(true);
    fetchProjects(orgId)
      .then(setProjects)
      .finally(() => setDataLoading(false));
  }, [auth.userId, currentOrgId]);

  const currentOrg = orgs.find((o) => o.id === currentOrgId);

  return {
    signedIn: !!auth.userId,
    loading: auth.initializing || dataLoading,
    email: auth.email,
    userId: auth.userId,
    orgs,
    currentOrgId,
    tier: currentOrg?.tier ?? "free",
    projects,
    switchOrg,
  };
}
