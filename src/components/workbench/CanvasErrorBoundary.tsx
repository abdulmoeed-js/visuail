import { Component, type ReactNode } from "react";
import { AlertOctagon, Undo2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reportLovableError } from "@/lib/lovable-error-reporting";

interface Props {
  children: ReactNode;
  /** Called when the user chooses to undo the most recent addition. This is
   *  the primary recovery path when a freshly-dropped shape crashes rendering
   *  — it deletes the offending item so the canvas can re-mount cleanly. */
  onRemoveLastAdded?: () => void;
  /** Fallback: nuke all user-added items to fully un-brick a project. */
  onResetAll?: () => void;
}

interface State { error: Error | null; }

/**
 * Wraps the interactive canvas. If any child throws during render (e.g. a
 * pathological shape triggers a "Maximum update depth" cascade), we catch it,
 * expose a "Remove last shape" action, and remount on retry — so a bad drop
 * never permanently bricks a persisted project.
 */
export class CanvasErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: unknown, info: unknown) {
    reportLovableError(error, { boundary: "CanvasErrorBoundary", info: String(info) });
  }

  private reset = () => this.setState({ error: null });

  private undo = () => {
    this.props.onRemoveLastAdded?.();
    this.reset();
  };

  private clear = () => {
    this.props.onResetAll?.();
    this.reset();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-xl border border-drift/40 bg-drift/[0.06] p-5 space-y-4 text-center">
          <div className="mx-auto size-10 rounded-full bg-drift/15 text-drift flex items-center justify-center">
            <AlertOctagon className="size-5" />
          </div>
          <div>
            <h3 className="font-display text-lg">The canvas hit a snag</h3>
            <p className="text-sm text-muted-foreground mt-1">
              The last change couldn't render. Roll it back to keep going —
              your other work is safe.
            </p>
            <p className="text-[11px] font-mono-tight text-muted-foreground/80 mt-2 break-words">
              {this.state.error.message}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {this.props.onRemoveLastAdded && (
              <Button size="sm" onClick={this.undo}>
                <Undo2 className="size-3.5" /> Undo last shape
              </Button>
            )}
            {this.props.onResetAll && (
              <Button size="sm" variant="outline" onClick={this.clear}>
                <RotateCcw className="size-3.5" /> Reset my additions
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={this.reset}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
