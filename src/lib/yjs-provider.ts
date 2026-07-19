// Bridges a Y.Doc to a Supabase Realtime broadcast channel. There's no
// official y-supabase package -- this is the standard pattern teams use to
// build a custom Yjs provider over any pub/sub transport: broadcast raw
// Yjs update bytes, apply incoming ones with Y.applyUpdate. Base64-encoded
// for the JSON broadcast payload rather than a raw byte array, since that
// round-trips 3-4x smaller.

import * as Y from "yjs";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const REMOTE_ORIGIN = "yjs-remote";

export interface YjsProviderHandle {
  channel: RealtimeChannel;
  destroy: () => void;
}

/** Joins `channelName`, applies every peer update it receives to `ydoc`,
 *  and broadcasts every local update (tagging remote-applied ones with
 *  REMOTE_ORIGIN so they're never rebroadcast -- each client only ever
 *  broadcasts changes that actually originated locally). */
export function connectYjsProvider(ydoc: Y.Doc, channelName: string): YjsProviderHandle {
  const channel = supabase.channel(channelName, { config: { broadcast: { self: false } } });

  channel.on("broadcast", { event: "yupdate" }, ({ payload }) => {
    const update = base64ToBytes(payload.update as string);
    Y.applyUpdate(ydoc, update, REMOTE_ORIGIN);
  });

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN) return;
    channel.send({ type: "broadcast", event: "yupdate", payload: { update: bytesToBase64(update) } });
  };
  ydoc.on("update", onDocUpdate);

  channel.subscribe();

  return {
    channel,
    destroy: () => {
      ydoc.off("update", onDocUpdate);
      supabase.removeChannel(channel);
    },
  };
}
