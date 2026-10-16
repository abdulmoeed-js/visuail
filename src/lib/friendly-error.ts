// Turning a failure into what a person can act on (DESIGN.md 6.12: what
// happened, why, what next; no codes, no "see console").
//
// Errors reach the UI in several shapes: database results are plain objects
// ({ code, message }), server functions throw EdgeError (edge.ts), sign-in
// throws AuthApiError, file readers throw their own Error types, and a lost
// connection throws a TypeError. The raw error is logged for support and
// never shown.

import { EdgeError } from "@/lib/edge";

export type ErrorKind =
  | "offline" | "signed-out" | "rate-limit" | "not-allowed" | "plan-limit"
  | "gone" | "file-locked" | "file-unreadable" | "invalid-email" | "unknown";

export interface FriendlyError {
  kind: ErrorKind;
  /** What happened, e.g. "Couldn't post your comment." */
  title: string;
  /** What to do next. */
  detail: string;
}

function field(err: unknown, key: string): string {
  if (err && typeof err === "object" && key in err) {
    const v = (err as Record<string, unknown>)[key];
    return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  }
  return "";
}

export function classifyError(err: unknown): { kind: ErrorKind; message?: string } {
  const name = field(err, "name");
  const code = field(err, "code");
  const message = field(err, "message");

  if (err instanceof EdgeError) {
    if (err.status === 0) return { kind: "offline" };
    if (err.status === 401) return { kind: "signed-out" };
    if (err.status === 403) return { kind: "not-allowed" };
    if (err.status === 429) return { kind: "rate-limit" };
    return { kind: "unknown" };
  }
  // A lost connection: fetch failures surface as TypeErrors, and database
  // results carry the same text in a plain object.
  if (name === "AuthRetryableFetchError" || name === "FunctionsFetchError" || /failed to fetch|load failed|networkerror|network request failed/i.test(message)) {
    return { kind: "offline" };
  }
  if (name === "PasswordException") return { kind: "file-locked" };
  if (name === "InvalidPDFException" || name === "MissingPDFException" || name === "UnknownErrorException") {
    return { kind: "file-unreadable" };
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return { kind: "rate-limit" };
  if (code === "email_address_invalid" || code === "validation_failed") return { kind: "invalid-email" };
  if (code === "signup_disabled" || code === "otp_disabled" || code === "email_address_not_authorized") return { kind: "not-allowed" };
  if (code === "42501") return { kind: "not-allowed" };
  if (code === "PGRST116") return { kind: "gone" };
  if (code === "PGRST301" || /jwt expired|invalid jwt/i.test(message)) return { kind: "signed-out" };
  // Plan limits are raised by our own database triggers, in plain words
  // meant for the person ("Free tier is limited to 2 projects...").
  if (code === "P0001" && message) return { kind: "plan-limit", message };
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { kind: "offline" };
  return { kind: "unknown" };
}

/**
 * @param doing what the person was trying to do, finishing "Couldn't ...":
 *   "post your comment", "create the share link".
 */
export function friendlyError(err: unknown, doing: string): FriendlyError {
  console.error(`Couldn't ${doing}:`, err);
  const { kind, message } = classifyError(err);
  const title = `Couldn't ${doing}.`;
  switch (kind) {
    case "offline":
      return { kind, title, detail: "You seem to be offline. Check your connection, then try again." };
    case "signed-out":
      return { kind, title, detail: "Your sign-in has expired. Sign in again to carry on." };
    case "rate-limit":
      return { kind, title, detail: "You've reached the limit for now. Try again later this hour." };
    case "not-allowed":
      return { kind, title, detail: "Your account isn't allowed to do this. Ask the workspace owner." };
    case "plan-limit":
      return { kind, title, detail: message ?? "Your plan doesn't include this. Upgrade to carry on." };
    case "gone":
      return { kind, title, detail: "It no longer exists. Someone may have deleted it." };
    case "file-locked":
      return { kind, title, detail: "This PDF is password-protected. Remove the password, then upload it again." };
    case "file-unreadable":
      return { kind, title, detail: "This file couldn't be read. Check it opens on your computer, or paste its text instead." };
    case "invalid-email":
      return { kind, title, detail: "That email address doesn't look right. Check it and try again." };
    default:
      return { kind, title, detail: "Try again in a moment." };
  }
}
