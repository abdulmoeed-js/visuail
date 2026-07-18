// Real session + project persistence, backed by Supabase Auth (magic link)
// and the `profiles` / `projects` tables. Mirrors the shape of the old
// localStorage-only version as closely as real async data allows -- reads
// stay a flat `Session` object (`signedIn`, `tier`, `projects`, ...), and
// writes are async functions on `sessionStore` that notify every mounted
// `useSession()` instance to refetch, the same cross-component refresh
// pattern the old version used for cross-tab localStorage updates.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ArtifactModel } from "@/data/samples";
import type { ArtifactKind } from "@/lib/extract";

export type Tier = "free" | "pro" | "team";

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
  tier: Tier;
  projects: StoredProject[];
}

const EVENT = "visuail:session";
const FREE_PROJECT_CAP = 2;
export const FREE_LIMIT = FREE_PROJECT_CAP;

function notify() {
  window.dispatchEvent(new CustomEvent(EVENT));
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

async function fetchTierAndProjects(userId: string): Promise<{ tier: Tier; projects: StoredProject[] }> {
  const [{ data: profile }, { data: rows }] = await Promise.all([
    supabase.from("profiles").select("tier").eq("id", userId).single(),
    supabase.from("projects").select("*").eq("user_id", userId).order("updated_at", { ascending: false }),
  ]);
  return {
    tier: (profile?.tier as Tier) ?? "free",
    projects: ((rows as ProjectRow[] | null) ?? []).map(fromRow),
  };
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

  async setTier(userId: string, tier: Tier): Promise<void> {
    const { error } = await supabase
      .from("profiles")
      .update({ tier, updated_at: new Date().toISOString() })
      .eq("id", userId);
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
    userId: string,
    p: Omit<StoredProject, "id" | "createdAt" | "updatedAt">,
  ): Promise<StoredProject> {
    const { data, error } = await supabase
      .from("projects")
      .insert({
        user_id: userId,
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
  const [data, setData] = useState<{ tier: Tier; projects: StoredProject[] }>({
    tier: "free",
    projects: [],
  });
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
      setData({ tier: "free", projects: [] });
      return;
    }
    setDataLoading(true);
    fetchTierAndProjects(auth.userId)
      .then(setData)
      .finally(() => setDataLoading(false));
  }, [auth.userId]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    window.addEventListener(EVENT, refetch);
    return () => window.removeEventListener(EVENT, refetch);
  }, [refetch]);

  return {
    signedIn: !!auth.userId,
    loading: auth.initializing || dataLoading,
    email: auth.email,
    userId: auth.userId,
    tier: data.tier,
    projects: data.projects,
  };
}
