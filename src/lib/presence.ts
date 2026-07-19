// "Who's here" for a project, via Supabase Realtime's built-in Presence
// feature -- separate from the Yjs broadcast channel used for actual edit
// sync (yjs-provider.ts), and separate from pixel-level cursor tracking,
// which is explicitly out of scope for this pass (see the plan).

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PresentUser {
  userId: string;
  email: string;
}

export function useProjectPresence(projectId: string, userId: string | undefined, email: string | undefined): PresentUser[] {
  const [present, setPresent] = useState<PresentUser[]>([]);

  useEffect(() => {
    if (!userId || !email) return;
    const channel = supabase.channel(`presence:project:${projectId}`, {
      config: { presence: { key: userId } },
    });

    const sync = () => {
      const state = channel.presenceState<{ email: string }>();
      const others: PresentUser[] = [];
      for (const [key, entries] of Object.entries(state)) {
        if (key === userId) continue;
        const entry = entries[0];
        if (entry) others.push({ userId: key, email: entry.email });
      }
      setPresent(others);
    };

    channel
      .on("presence", { event: "sync" }, sync)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ email });
      });

    return () => { supabase.removeChannel(channel); };
  }, [projectId, userId, email]);

  return present;
}
