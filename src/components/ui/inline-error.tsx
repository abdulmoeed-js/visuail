import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FriendlyError } from "@/lib/friendly-error";

/** A failure shown where it happened, in place of a browser alert box:
 *  what happened, what to do next, and an optional way to try again. */
export function InlineError({
  error, onRetry, retryLabel = "Try again", className,
}: {
  error: Pick<FriendlyError, "title" | "detail"> | null;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  if (!error) return null;
  return (
    <div role="alert" className={cn("flex items-start gap-2 rounded-lg bg-drift/10 px-3 py-2 text-[13px] leading-snug", className)}>
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-drift-ink" aria-hidden />
      <div className="min-w-0">
        <span className="font-medium text-drift-ink">{error.title}</span>{" "}
        <span className="text-foreground">{error.detail}</span>
        {onRetry && (
          <>
            {" "}
            <button
              type="button"
              onClick={onRetry}
              className="text-primary underline decoration-1 underline-offset-4 decoration-[color-mix(in_oklab,currentColor_40%,transparent)] hover:decoration-current"
            >
              {retryLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
