// Local-only session + project persistence. No backend; all state lives in
// localStorage. Mirrors the "mocked but real-feeling" pattern used elsewhere
// in the app (Slack sends, checkout, AI refinement).

import { useEffect, useState } from "react";
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
  email?: string;
  tier: Tier;
  projects: StoredProject[];
}

const KEY = "visuail.session.v1";
const FREE_PROJECT_CAP = 2;

const empty: Session = { signedIn: false, tier: "free", projects: [] };

function read(): Session {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Session;
    return { ...empty, ...parsed, projects: parsed.projects ?? [] };
  } catch {
    return empty;
  }
}

function write(s: Session) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent("visuail:session"));
}

export const sessionStore = {
  get: read,
  set: write,
  signIn(email?: string) {
    const s = read();
    write({ ...s, signedIn: true, email: email ?? s.email });
  },
  setTier(tier: Tier) {
    const s = read();
    write({ ...s, signedIn: true, tier });
  },
  canCreateProject(): { ok: boolean; reason?: string } {
    const s = read();
    if (s.tier !== "free") return { ok: true };
    if (s.projects.length >= FREE_PROJECT_CAP) {
      return {
        ok: false,
        reason: `Free tier is limited to ${FREE_PROJECT_CAP} projects. Upgrade to Pro for unlimited.`,
      };
    }
    return { ok: true };
  },
  createProject(p: Omit<StoredProject, "id" | "createdAt" | "updatedAt">): StoredProject {
    const s = read();
    const now = Date.now();
    const project: StoredProject = {
      ...p,
      id: `p_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    };
    write({ ...s, signedIn: true, projects: [project, ...s.projects] });
    return project;
  },
  updateProject(id: string, patch: Partial<StoredProject>) {
    const s = read();
    const projects = s.projects.map(p =>
      p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p,
    );
    write({ ...s, projects });
  },
  deleteProject(id: string) {
    const s = read();
    write({ ...s, projects: s.projects.filter(p => p.id !== id) });
  },
  getProject(id: string): StoredProject | undefined {
    return read().projects.find(p => p.id === id);
  },
  clear() {
    write(empty);
  },
};

export const FREE_LIMIT = FREE_PROJECT_CAP;

/** React hook that subscribes to session changes across tabs / dispatches. */
export function useSession(): Session {
  const [s, setS] = useState<Session>(() => read());
  useEffect(() => {
    const on = () => setS(read());
    window.addEventListener("visuail:session", on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener("visuail:session", on);
      window.removeEventListener("storage", on);
    };
  }, []);
  return s;
}
