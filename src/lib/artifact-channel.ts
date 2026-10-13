// The live channel between the browsers that have one artifact open.
//
// One editor, any number of viewers. The editor sends the whole artifact
// (the plain model) after every change; viewers adopt it. A browser that has
// just arrived asks for the latest, so it sees edits the editor has made but
// not yet saved. That is all the channel carries.
//
// Why not Yjs updates (what this channel carried until 2026-10-13): each
// browser builds its own Y.Doc from the saved JSON, so an update from one
// refers to list containers the other never had, and it can never be
// applied. Two browsers never saw each other's edits, and the last to save
// won. Whole snapshots from a single editor cannot lose work. A shared seed
// would allow true simultaneous editing later; that is a separate job.

import { supabase } from "@/integrations/supabase/client";
import type { ArtifactModel } from "@/data/samples";
import { toast } from "sonner";

// Supabase drops a broadcast above its size cap (256 KB on the free plan)
// without a word. Typical artifacts are a few KB; this is a cliff, not a
// daily case, so the editor is told once and the others see it on reload.
const MAX_PAYLOAD_BYTES = 200_000;
let warnedTooBig = false;

export interface ArtifactChannelHandle {
  /** Editor only: tell the other browsers what the artifact looks like now. */
  send: (model: ArtifactModel) => void;
  destroy: () => void;
}

export function connectArtifactChannel(
  channelName: string,
  tabId: string,
  handlers: {
    onModel: (model: ArtifactModel, from: string) => void;
    onSyncRequest: (from: string) => void;
  },
): ArtifactChannelHandle {
  const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });

  channel.on("broadcast", { event: "model" }, ({ payload }) => {
    if (!payload || payload.from === tabId || !payload.model) return;
    handlers.onModel(payload.model as ArtifactModel, String(payload.from));
  });
  channel.on("broadcast", { event: "sync-request" }, ({ payload }) => {
    if (!payload || payload.from === tabId) return;
    handlers.onSyncRequest(String(payload.from));
  });
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void channel.send({ type: "broadcast", event: "sync-request", payload: { from: tabId } });
    }
  });

  return {
    send: (model) => {
      const message = { type: "broadcast" as const, event: "model", payload: { from: tabId, model } };
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
    destroy: () => {
      supabase.removeChannel(channel);
    },
  };
}
