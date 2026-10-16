// Calling a Supabase server function, keeping the reason it refused.
//
// supabase-js reports every non-2xx reply as "Edge Function returned a non-2xx
// status code" and leaves the function's own message unread in
// `error.context` (a Response). That made a sign-in expiry, the hourly
// extraction limit and an owner-only action all look alike. This reads the
// status and the body once, so friendlyError() can say what actually happened.

import { supabase } from "@/integrations/supabase/client";

export class EdgeError extends Error {
  constructor(
    /** HTTP status, or 0 when the request never reached the server. */
    readonly status: number,
    /** The function's own message, for logs; never shown as-is. */
    readonly serverMessage: string,
  ) {
    super(serverMessage || `Server function failed (${status})`);
    this.name = "EdgeError";
  }
}

export async function invokeEdge<T>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body as Record<string, unknown> });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context instanceof Response) {
      let message = "";
      try {
        const parsed = (await context.clone().json()) as { error?: string; message?: string };
        message = parsed?.error ?? parsed?.message ?? "";
      } catch {
        message = await context.text().catch(() => "");
      }
      throw new EdgeError(context.status, message);
    }
    // FunctionsFetchError / FunctionsRelayError: the request never got a reply.
    throw new EdgeError(0, error.message);
  }
  const maybe = data as { error?: string } | null;
  if (maybe && typeof maybe === "object" && typeof maybe.error === "string" && maybe.error) {
    throw new EdgeError(200, maybe.error);
  }
  return data as T;
}
