// Build empty starter models for "start from scratch" projects. The user then
// fills them via the existing +Add controls already in the canvas.

import type { ArtifactModel, BMCModel, ProcessModel, BMCBlock } from "@/data/samples";
import type { ArtifactKind } from "@/lib/extract";

export function emptyProcess(title: string): ProcessModel {
  return {
    kind: "process",
    title,
    actors: [],
    steps: [],
    decisions: [],
    exceptions: [],
    systems: [],
  };
}

export function emptyBMC(title: string): BMCModel {
  const ids: Array<[BMCBlock["id"], string]> = [
    ["segments", "Customer Segments"],
    ["value", "Value Propositions"],
    ["channels", "Channels"],
    ["relationships", "Customer Relationships"],
    ["revenue", "Revenue Streams"],
    ["resources", "Key Resources"],
    ["activities", "Key Activities"],
    ["partnerships", "Key Partnerships"],
    ["costs", "Cost Structure"],
  ];
  return {
    kind: "bmc",
    title,
    blocks: ids.map(([id, t]) => ({ id, title: t, items: [] })),
  };
}

export function emptyCanvas(kind: ArtifactKind, title: string): ArtifactModel {
  return kind === "process" ? emptyProcess(title) : emptyBMC(title);
}
