// The live channel between the browser tabs that have one artifact open.
//
// It carries two things. First, who is here: every tab with the artifact on
// screen says so every few seconds ("here", with when it opened the artifact,
// whether it pressed Take over and which model schema its build runs) and
// says "bye" when it leaves; a tab
// that falls silent is forgotten after a while. The project page turns that
// into "one editor, everyone else views". Second, the artifact itself: the
// editor sends the whole model after every change, viewers adopt it, and a
// tab that has just arrived asks for the latest.
//
// Why broadcasts and not Supabase Presence for "who is here": on this
// project, presence updates crashed on the server and went undelivered for
// minutes at a time (2026-10-13), while broadcasts never missed. Why whole
// models and not Yjs updates: each browser builds its own Y.Doc, so updates
// from one can never be applied by another.

import { supabase } from "@/integrations/supabase/client";
import type { ArtifactModel } from "@/data/samples";
import { MODEL_SCHEMA, schemaOf } from "@/lib/model-schema";
import { toast } from "sonner";

export interface Peer {
  tabId: string;
  userId: string;
  email: string;
  /** When this tab opened the artifact. First to open edits. */
  openedAt: number;
  /** When this tab pressed "Take over", if it did. Latest claim edits. */
  claimedAt: number | null;
  /** The model schema the tab's build runs (model-schema.ts). Tabs from
   *  before the number existed send none and count as 1. */
  schema: number;
  /** Last time this tab was heard from (local clock). */
  lastSeen: number;
}

export type Here = Omit<Peer, "lastSeen">;

export interface ArtifactChannelHandle {
  /** Editor only: tell the other tabs what the artifact looks like now. */
  send: (model: ArtifactModel) => void;
  /** "I have this artifact open" (repeated; also the way to claim it). */
  here: (me: Here) => void;
  /** "I no longer have it open." */
  bye: (tabId: string) => void;
  /** Ask whoever is editing for its latest model. */
  requestSync: () => void;
  destroy: () => void;
}

// Supabase drops a broadcast above its size cap (256 KB on the free plan)
// without a word. Typical artifacts are a few KB; this is a cliff, not a
// daily case, so the editor is told once and the others see it on reload.
const MAX_PAYLOAD_BYTES = 200_000;
let warnedTooBig = false;

export function connectArtifactChannel(
  channelName: string,
  tabId: string,
  handlers: {
    /** `schema` is the sender's build (model-schema.ts); 1 from tabs that
     *  predate the number. */
    onModel: (model: ArtifactModel, from: string, schema: number) => void;
    onSyncRequest: (from: string) => void;
    onHere: (peer: Here) => void;
    onBye: (tabId: string) => void;
    onJoined: () => void;
  },
): ArtifactChannelHandle {
  const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });

  channel.on("broadcast", { event: "model" }, ({ payload }) => {
    if (!payload || payload.from === tabId || !payload.model) return;
    handlers.onModel(payload.model as ArtifactModel, String(payload.from), schemaOf(payload));
  });
  channel.on("broadcast", { event: "sync-request" }, ({ payload }) => {
    if (!payload || payload.from === tabId) return;
    handlers.onSyncRequest(String(payload.from));
  });
  channel.on("broadcast", { event: "here" }, ({ payload }) => {
    const p = payload as Partial<Here> | undefined;
    if (!p || typeof p.tabId !== "string" || p.tabId === tabId) return;
    handlers.onHere({
      tabId: p.tabId, userId: String(p.userId ?? ""), email: String(p.email ?? ""),
      openedAt: Number(p.openedAt) || 0, claimedAt: p.claimedAt == null ? null : Number(p.claimedAt),
      schema: schemaOf(p),
    });
  });
  channel.on("broadcast", { event: "bye" }, ({ payload }) => {
    if (!payload || typeof payload.tabId !== "string" || payload.tabId === tabId) return;
    handlers.onBye(payload.tabId);
  });
  channel.subscribe((status) => {
    // Fires again after the library rejoins on its own, so a tab that was
    // cut off re-announces itself and asks for the latest.
    if (status === "SUBSCRIBED") {
      void channel.send({ type: "broadcast", event: "sync-request", payload: { from: tabId } });
      handlers.onJoined();
    }
  });

  return {
    send: (model) => {
      const message = { type: "broadcast" as const, event: "model", payload: { from: tabId, model, schema: MODEL_SCHEMA } };
      if (JSON.stringify(message).length > MAX_PAYLOAD_BYTES) {
        if (!warnedTooBig) {
          warnedTooBig = true;
          toast("This artifact is too large to share live", {
            description: "Your changes are saved; other people will see them after they reload.",
          });
        }
        return;
      }
      void channel.send(message);
    },
    here: (me) => { void channel.send({ type: "broadcast", event: "here", payload: me }); },
    bye: (id) => { void channel.send({ type: "broadcast", event: "bye", payload: { tabId: id } }); },
    requestSync: () => { void channel.send({ type: "broadcast", event: "sync-request", payload: { from: tabId } }); },
    destroy: () => { supabase.removeChannel(channel); },
  };
}

/** Who edits, given every tab that has the artifact open: among the tabs on
 *  the newest schema, the latest to claim it, else the first to open it,
 *  ties by tab id. Null when none. An older tab never edits next to a newer
 *  one: its save would drop what only the newer build knows. */
export function editorOf(peers: Peer[]): Peer | null {
  if (peers.length === 0) return null;
  const newest = Math.max(...peers.map((p) => p.schema));
  const current = peers.filter((p) => p.schema === newest);
  const claimed = current.filter((p) => p.claimedAt != null);
  const pool = claimed.length > 0 ? claimed : current;
  return [...pool].sort((a, b) =>
    claimed.length > 0
      ? (b.claimedAt! - a.claimedAt!) || a.tabId.localeCompare(b.tabId)
      : (a.openedAt - b.openedAt) || a.tabId.localeCompare(b.tabId),
  )[0];
}
