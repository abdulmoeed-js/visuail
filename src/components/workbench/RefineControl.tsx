import { useState } from "react";
import { Wand2, Check, X, AlertTriangle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProcessModel } from "@/data/samples";
import {
  proposeRefinement,
  proposalHeadline,
  type NodeKind,
  type Proposal,
} from "@/lib/refine";

interface Props {
  node: { id: string; kind: NodeKind; text: string };
  model: ProcessModel;
  onApply: (p: Proposal) => void;
  className?: string;
}

/**
 * Small wand affordance rendered next to node controls. Opens a compact
 * inline prompt, produces a mocked-deterministic Proposal, and shows a
 * before/after diff before the user commits to writing anything to the IR.
 */
export function RefineControl({ node, model, onApply, className }: Props) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const reset = () => {
    setPrompt("");
    setProposal(null);
  };

  const generate = () => {
    const p = proposeRefinement(node, model, prompt);
    setProposal(p);
  };

  const accept = () => {
    if (!proposal) return;
    onApply(proposal);
    reset();
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <PopoverTrigger asChild>
        <button
          data-no-pan
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "text-muted-foreground hover:text-primary opacity-0 group-hover:opacity-100 transition inline-flex items-center",
            open && "opacity-100 text-primary",
            className,
          )}
          title="Refine with AI"
          aria-label="Refine with AI"
        >
          <Wand2 className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-0 overflow-hidden"
        data-no-pan
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 py-2 border-b bg-muted/40 flex items-center gap-2">
          <Wand2 className="size-3.5 text-primary" />
          <div className="text-[11px] font-mono-tight uppercase tracking-widest text-muted-foreground">
            Refine {node.id} with AI
          </div>
        </div>

        {!proposal && (
          <div className="p-3 space-y-2">
            <textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (prompt.trim()) generate();
                }
              }}
              placeholder="Describe the change… e.g. split into two steps, add exception for missing signature, require approval from Legal"
              className="w-full min-h-[72px] resize-y rounded-md border bg-background px-2.5 py-1.5 text-xs leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] text-muted-foreground leading-tight">
                Mocked deterministic transform · no LLM call
              </div>
              <Button size="sm" className="h-7 px-2.5" disabled={!prompt.trim()} onClick={generate}>
                <Wand2 className="size-3" /> Propose
              </Button>
            </div>
          </div>
        )}

        {proposal && (
          <div className="p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold">{proposalHeadline(proposal)}</div>
              {proposal.kind === "rewrite" && proposal.lowConfidence && (
                <span className="inline-flex items-center gap-1 rounded-full border border-unresolved/60 bg-unresolved/10 px-1.5 py-0.5 text-[9px] font-mono-tight text-unresolved">
                  <AlertTriangle className="size-2.5" /> low confidence
                </span>
              )}
            </div>

            <ProposalDiff proposal={proposal} />

            <div className="text-[10px] text-muted-foreground leading-snug border-t pt-2">
              {proposal.note}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={reset}>
                <X className="size-3" /> Reject
              </Button>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setProposal(null)}>
                  Edit prompt
                </Button>
                <Button size="sm" className="h-7 px-2.5" onClick={accept}>
                  <Check className="size-3" /> Accept
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// --- Diff renderers ---

function Removed({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-drift/50 bg-drift/5 px-2 py-1.5 text-[11px] leading-snug text-drift line-through decoration-drift/60">
      {children}
    </div>
  );
}

function Added({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="rounded-md border border-verified/60 bg-verified/10 px-2 py-1.5 text-[11px] leading-snug">
      {label && (
        <div className="text-[9px] font-mono-tight uppercase tracking-widest text-verified mb-0.5">
          + {label}
        </div>
      )}
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function ProposalDiff({ proposal }: { proposal: Proposal }) {
  switch (proposal.kind) {
    case "rewrite":
      return (
        <div className="space-y-1.5">
          <Removed>{proposal.before}</Removed>
          <Added label={`${proposal.targetId} · rewritten`}>{proposal.after}</Added>
        </div>
      );
    case "split":
      return (
        <div className="space-y-1.5">
          <Removed>{proposal.before}</Removed>
          <Added label="new step (a)">{proposal.afterA}</Added>
          <Added label="new step (b)">{proposal.afterB}</Added>
        </div>
      );
    case "addException":
      return (
        <div className="space-y-1.5">
          <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
            <span className="text-[9px] font-mono-tight uppercase tracking-widest mr-1.5">
              linked to {proposal.anchorStepId}
            </span>
            {proposal.anchorText}
          </div>
          <Added label="new exception">{proposal.text}</Added>
        </div>
      );
    case "insertApproval":
      return (
        <div className="space-y-1.5">
          <div className="rounded-md border bg-muted/40 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
            <span className="text-[9px] font-mono-tight uppercase tracking-widest mr-1.5">
              after {proposal.anchorStepId}
            </span>
            {proposal.anchorText}
          </div>
          <Added label="new decision">
            <div>{proposal.newDecisionText}</div>
            <div className="mt-1 flex gap-2 text-[10px] font-mono-tight">
              <span className="text-confident">yes → continue</span>
              <span className="text-drift">no → rework</span>
            </div>
          </Added>
        </div>
      );
    case "mergeWithNext":
      return (
        <div className="space-y-1.5">
          <Removed>{proposal.beforeA}</Removed>
          <Removed>{proposal.beforeB}</Removed>
          <Added label={`merged into ${proposal.targetId}`}>{proposal.after}</Added>
        </div>
      );
  }
}
