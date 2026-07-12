import { cn } from "@/lib/utils";
import type { BaseItem } from "@/data/samples";
import { Check } from "lucide-react";

export function ConfidenceDot({ value, className }: { value: number; className?: string }) {
  const tone =
    value >= 0.85 ? "bg-confident" :
    value >= 0.7  ? "bg-[color:var(--confident)]/70" :
                    "bg-unresolved";
  return <span className={cn("inline-block h-2 w-2 rounded-full", tone, className)} />;
}

export function ConfidenceBadge({ item }: { item: BaseItem }) {
  const pct = Math.round(item.confidence * 100);
  const drift = item.drift;
  const low = item.confidence < 0.7;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px] font-mono-tight",
        drift
          ? "border-drift bg-drift/10 text-drift"
          : item.userAdded
          ? "border-verified bg-verified/10 text-verified"
          : low
          ? "border-unresolved bg-unresolved/15 text-[color:var(--unresolved-foreground)]"
          : "border-confident/40 bg-confident/10 text-[color:var(--confident)]",
      )}
      title={drift ? "Drifted — source changed" : low ? "Low confidence — unresolved" : "Confident"}
    >
      {item.userAdded ? <Check className="!size-2.5" /> : <ConfidenceDot value={item.confidence} />}
      {item.userAdded ? "verified" : `${pct}%`}
    </span>
  );
}

export function IdChip({ id, tone = "muted" }: { id: string; tone?: "muted" | "primary" }) {
  return (
    <span
      className={cn(
        "font-mono-tight text-[10px] px-1.5 py-0.5 rounded",
        tone === "primary"
          ? "bg-primary/10 text-primary"
          : "bg-muted text-muted-foreground",
      )}
    >
      {id}
    </span>
  );
}
