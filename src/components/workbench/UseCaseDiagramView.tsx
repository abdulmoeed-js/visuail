import { useMemo } from "react";
import type { ProcessModel } from "@/data/samples";
import { cn } from "@/lib/utils";
import { CanvasShell } from "./CanvasShell";
import { IdChip } from "./atoms";
import { useCasesByActor, type ActorUseCases } from "@/lib/usecase";
import { User } from "lucide-react";

// Standard use-case-diagram notation: actors sit outside a labeled system
// boundary, ovals inside it are use cases, straight lines associate the two.
// Pure derivation from the existing ProcessModel -- no stored layout, no new
// fields, so this is safe to recompute on every render.

const ACTOR_W = 168;
const ACTOR_H = 56;
const UC_W = 248;
const UC_H = 48;
const ROW_GAP = 14;
const GROUP_GAP = 36;
const TOP_PAD = 64;
const ACTOR_X = 40;
const BOUNDARY_X = ACTOR_X + ACTOR_W + 110;
const BOUNDARY_PAD_X = 36;
const BOUNDARY_PAD_TOP = 44;
const BOUNDARY_PAD_BOTTOM = 28;
const UC_X = BOUNDARY_X + BOUNDARY_PAD_X;

interface Placed {
  group: ActorUseCases;
  actorCy: number;
  ucY: number[]; // top y per use case, aligned to group.useCases
}

function layout(groups: ActorUseCases[]) {
  const placed: Placed[] = [];
  let y = TOP_PAD;
  for (const group of groups) {
    const groupTop = y;
    const ucY = group.useCases.map((_, i) => groupTop + i * (UC_H + ROW_GAP));
    const groupHeight = group.useCases.length * UC_H + (group.useCases.length - 1) * ROW_GAP;
    const actorCy = groupTop + groupHeight / 2;
    placed.push({ group, actorCy, ucY });
    y = groupTop + groupHeight + GROUP_GAP;
  }
  const contentBottom = y - GROUP_GAP;
  const boundaryHeight = Math.max(120, contentBottom - TOP_PAD + BOUNDARY_PAD_TOP + BOUNDARY_PAD_BOTTOM);
  const boundaryWidth = UC_W + BOUNDARY_PAD_X * 2;
  const width = UC_X + boundaryWidth + 60;
  const height = Math.max(320, TOP_PAD - BOUNDARY_PAD_TOP + boundaryHeight + 40);
  return { placed, boundaryWidth, boundaryHeight, width, height };
}

export function UseCaseDiagramView({
  model, onSelectUseCase,
}: {
  model: ProcessModel;
  onSelectUseCase?: (stepId: string) => void;
}) {
  const groups = useMemo(() => useCasesByActor(model), [model]);
  const { placed, boundaryWidth, boundaryHeight, width, height } = useMemo(() => layout(groups), [groups]);

  if (groups.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Add actors and steps on the Process map to see a use case diagram here.
      </div>
    );
  }

  const boundaryTop = TOP_PAD - BOUNDARY_PAD_TOP;

  return (
    <CanvasShell
      contentWidth={Math.max(width, 700)}
      contentHeight={Math.max(height, 420)}
      fullscreenLabel="Use case diagram — fullscreen"
    >
      <svg
        width={Math.max(width, 700)}
        height={Math.max(height, 420)}
        className="absolute inset-0"
        style={{ pointerEvents: "none" }}
      >
        {placed.map(({ group, actorCy, ucY }) =>
          group.useCases.map((uc, i) => (
            <line
              key={`assoc-${uc.id}`}
              x1={ACTOR_X + ACTOR_W}
              y1={actorCy}
              x2={UC_X}
              y2={ucY[i] + UC_H / 2}
              stroke="var(--border)"
              strokeWidth={1.5}
            />
          )),
        )}
      </svg>

      {/* System boundary */}
      <div
        className="absolute rounded-lg border-2 border-dashed bg-card/40"
        style={{ left: BOUNDARY_X, top: boundaryTop, width: boundaryWidth, height: boundaryHeight }}
      >
        <div className="absolute -top-3 left-3 rounded bg-background px-2 text-[11px] font-mono-tight uppercase tracking-widest text-muted-foreground">
          {model.title}
        </div>
      </div>

      {placed.map(({ group, actorCy, ucY }) => (
        <div key={group.actor.id}>
          <div
            data-node
            className="absolute flex items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-sm"
            style={{ left: ACTOR_X, top: actorCy - ACTOR_H / 2, width: ACTOR_W, height: ACTOR_H }}
          >
            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="size-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold leading-tight">{group.actor.text}</div>
              <IdChip id={group.actor.id} />
            </div>
          </div>

          {group.useCases.map((uc, i) => (
            <button
              key={uc.id}
              type="button"
              data-node
              onClick={() => onSelectUseCase?.(uc.id)}
              className={cn(
                "absolute flex items-center justify-center rounded-full border bg-card px-4 text-center text-[12px] leading-snug shadow-sm transition-colors",
                onSelectUseCase && "cursor-pointer hover:border-primary hover:bg-primary/5",
              )}
              style={{ left: UC_X, top: ucY[i], width: UC_W, height: UC_H }}
              title={uc.title}
            >
              <span className="line-clamp-2">{uc.title}</span>
            </button>
          ))}
        </div>
      ))}
    </CanvasShell>
  );
}
