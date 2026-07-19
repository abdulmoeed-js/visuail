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
};

export function useSession(): Session {
  const [auth, setAuth] = useState<{ userId?: string; email?: string; initializing: boolean }>({
    initializing: true,
  });
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [currentOrgId, setCurrentOrgId] = useState<string | undefined>(undefined);
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: s }) => {
      const u = s.session?.user;
      setAuth({ userId: u?.id, email: u?.email, initializing: false });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const u = s?.user;
      setAuth({ userId: u?.id, email: u?.email, initializing: false });
    });
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
