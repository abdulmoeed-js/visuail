import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { InlineError } from "@/components/ui/inline-error";
import { friendlyError, type FriendlyError } from "@/lib/friendly-error";

/**
 * Asks before something that can't easily be undone, in place of the
 * browser's OK/Cancel box. The title names the thing ("Delete “Acme”?"),
 * the buttons name the action ("Delete project" / "Keep it"). It stays open
 * while the action runs, shows a failure inside itself, and closes on success.
 */
export function ConfirmDialog({
  open, onOpenChange, title, consequence, confirmLabel, busyLabel, cancelLabel = "Keep it",
  tone = "destructive", doing, onConfirm, onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  consequence: ReactNode;
  confirmLabel: string;
  /** Present-tense label while it runs, e.g. "Deleting…". */
  busyLabel?: string;
  cancelLabel?: string;
  tone?: "destructive" | "default";
  /** Finishes "Couldn't ..." if it fails, e.g. "delete the project". */
  doing: string;
  onConfirm: () => Promise<void> | void;
  /** Where focus goes when it closes; there is no trigger to return to. */
  onCloseAutoFocus?: (e: Event) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);

  const change = (next: boolean) => {
    if (busy) return;
    if (!next) setError(null);
    onOpenChange(next);
  };

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onOpenChange(false);
    } catch (err) {
      setBusy(false);
      setError(friendlyError(err, doing));
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={change}>
      <AlertDialogContent
        onEscapeKeyDown={(e) => { if (busy) e.preventDefault(); }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{consequence}</AlertDialogDescription>
        </AlertDialogHeader>
        <InlineError error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{cancelLabel}</AlertDialogCancel>
          {/* aria-disabled rather than disabled while busy, so keyboard focus
              stays on the button and a retry after a failure is one key away. */}
          <AlertDialogAction
            variant={tone}
            aria-disabled={busy}
            onClick={(e) => { e.preventDefault(); void run(); }}
          >
            {busy ? <><Loader2 className="animate-spin" aria-hidden /> {busyLabel ?? confirmLabel}</> : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
