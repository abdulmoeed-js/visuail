// "Who's here, and what are they looking at" for a project, via Supabase
// Realtime's built-in Presence. One entry per browser tab (not per person:
// the same person on two devices is two editors). Each entry says which
// artifact that tab has open and when, and whether the tab has claimed the
// right to edit it; the project page turns that into "one editor per
// artifact, everyone else views". Separate from the artifact channel that
// carries the editor's changes (artifact-channel.ts). Pixel-level cursors
// are out of scope.

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PresentUser {
  userId: string;
  email: string;
  tabId: string;
  /** The artifact this tab has open, or null on the project hub. */
  paneId: string | null;
  /** When this tab opened that artifact. First to open edits. */
  openedAt: number;
  /** When this tab pressed "Take over", if it did. Latest claim edits. */
  claimedAt: number | null;
}

export type MyPresence = Pick<PresentUser, "tabId" | "paneId" | "openedAt" | "claimedAt">;

const PRESENCE_MAX_SENDS = 5;
const PRESENCE_WINDOW_MS = 30_000;
const PRESENCE_RETRY_MS = 5_000;

/** Everyone in the project, this tab included. */
export function useProjectPresence(
  projectId: string,
  userId: string | undefined,
  email: string | undefined,
  me: MyPresence,
): PresentUser[] {
  const [present, setPresent] = useState<PresentUser[]>([]);
  const payload = JSON.stringify({ userId, email, ...me });
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const trackRef = useRef<((p: string) => void) | null>(null);
  // Bumped when the channel dies, so it is joined again.
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!userId || !email) return;
    let gone = false;
    const channel = supabase.channel(`presence:project:${projectId}`, {
      config: { presence: { key: `${userId}:${me.tabId}` } },
    });

    const sync = () => {
      const state = channel.presenceState<Omit<PresentUser, "userId"> & { userId?: string }>();
      const all: PresentUser[] = [];
      for (const entries of Object.values(state)) {
        // A tab that updates its presence can be listed twice under its key
        // for a moment, oldest first. The newest entry is the truth; reading
        // the oldest is how a "take over" went unseen.
        const e = entries[entries.length - 1];
        if (!e || !e.tabId) continue;
        all.push({
          userId: e.userId ?? "", email: e.email, tabId: e.tabId,
          paneId: e.paneId ?? null, openedAt: Number(e.openedAt) || 0,
          claimedAt: e.claimedAt == null ? null : Number(e.claimedAt),
        });
      }
      setPresent(all);
    };

    // Supabase allows a handful of presence updates per client per half
    // minute. Only the newest state matters, so past the limit the latest
    // payload waits and goes once the oldest send has aged out.
    let subscribed = false;
    const sent: number[] = [];
    let waiting: ReturnType<typeof setTimeout> | null = null;
    const send = (p: string) => {
      if (!subscribed || gone) return;
      const now = Date.now();
      while (sent.length && now - sent[0] > PRESENCE_WINDOW_MS) sent.shift();
      if (sent.length >= PRESENCE_MAX_SENDS) {
        if (waiting) clearTimeout(waiting);
        waiting = setTimeout(() => { waiting = null; send(payloadRef.current); }, PRESENCE_WINDOW_MS - (now - sent[0]) + 50);
        return;
      }
      sent.push(now);
      void channel.track(JSON.parse(p));
    };
    trackRef.current = send;
    channel
      .on("presence", { event: "sync" }, sync)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          subscribed = true;
          send(payloadRef.current);
        } else if ((status === "CHANNEL_ERROR" || status === "CLOSED") && !gone) {
          // Not our own teardown: rejoin after a pause, or this tab keeps a
          // frozen picture of who is editing.
          subscribed = false;
          setTimeout(() => { if (!gone) setGeneration((g) => g + 1); }, PRESENCE_RETRY_MS);
        }
      });

    return () => {
      gone = true;
      if (waiting) clearTimeout(waiting);
      trackRef.current = null;
      supabase.removeChannel(channel);
    };
    // The tab id never changes; everything else about "me" is re-tracked below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, userId, email, generation]);

  // What this tab is doing changed (opened another artifact, took over):
  // tell the others without rejoining.
  useEffect(() => { trackRef.current?.(payload); }, [payload]);

  return present;
}

/** Who edits artifact `paneId`, given everyone's presence: the latest tab to
 *  claim it, else the first tab to open it. Null when nobody has it open. */
export function editorOf(present: PresentUser[], paneId: string): PresentUser | null {
  const here = present.filter((p) => p.paneId === paneId);
  if (here.length === 0) return null;
  const claimed = here.filter((p) => p.claimedAt != null);
  const pool = claimed.length > 0 ? claimed : here;
  return [...pool].sort((a, b) =>
    claimed.length > 0
      ? (b.claimedAt! - a.claimedAt!) || a.tabId.localeCompare(b.tabId)
      : (a.openedAt - b.openedAt) || a.tabId.localeCompare(b.tabId),
  )[0];
}
