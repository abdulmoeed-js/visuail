// Single source of truth for the 7 top-level creatable artifact/view types --
// previously duplicated (process/bmc only) between ArtifactSidebar and
// ArtifactBoard. Centralized here now that the set has grown to 7 and both
// the hub and the "new project" wizard need to iterate it.

import type { ComponentType, SVGProps } from "react";
import type { ArtifactKind } from "@/lib/extract";
import { VIEW_KIND_LABELS, type ViewKind } from "@/lib/session";
import {
  ProcessMapIcon, BMCIcon, DFDIcon, RACIIcon, DecisionTreeIcon, StateDiagramIcon, ActivityIcon,
} from "@/components/workbench/ViewKindIcons";

export const ALL_VIEW_KINDS: ViewKind[] = [
  "process", "bmc", "dfd", "raci", "decisiontree", "statediagram", "activity",
];

interface ViewKindMeta {
  label: string;
  plural: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const VIEW_KIND_META: Record<ViewKind, ViewKindMeta> = {
  process: { label: VIEW_KIND_LABELS.process, plural: "Process maps", icon: ProcessMapIcon },
  bmc: { label: VIEW_KIND_LABELS.bmc, plural: "Business Model Canvases", icon: BMCIcon },
  dfd: { label: VIEW_KIND_LABELS.dfd, plural: "Data Flow Diagrams", icon: DFDIcon },
  raci: { label: VIEW_KIND_LABELS.raci, plural: "RACI Matrices", icon: RACIIcon },
  decisiontree: { label: VIEW_KIND_LABELS.decisiontree, plural: "Decision Trees", icon: DecisionTreeIcon },
  statediagram: { label: VIEW_KIND_LABELS.statediagram, plural: "State Diagrams", icon: StateDiagramIcon },
  activity: { label: VIEW_KIND_LABELS.activity, plural: "Activity Diagrams", icon: ActivityIcon },
};

/** "bmc" is the only viewKind backed by a BMCModel; every other viewKind
 *  (including the 5 new diagram types) is a lens over a ProcessModel. */
export function underlyingKind(vk: ViewKind): ArtifactKind {
  return vk === "bmc" ? "bmc" : "process";
}
