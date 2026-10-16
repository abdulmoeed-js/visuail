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
  /** Also the default name of a new artifact, which is stored: keep as is. */
  label: string;
  /** The kind inside a sentence ("New data flow diagram"); the Business Model
   *  Canvas keeps its capitals as the method's own name. */
  noun: string;
  plural: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

export const VIEW_KIND_META: Record<ViewKind, ViewKindMeta> = {
  process: { label: VIEW_KIND_LABELS.process, noun: "process map", plural: "Process maps", icon: ProcessMapIcon },
  bmc: { label: VIEW_KIND_LABELS.bmc, noun: "Business Model Canvas", plural: "Business Model Canvases", icon: BMCIcon },
  dfd: { label: VIEW_KIND_LABELS.dfd, noun: "data flow diagram", plural: "Data flow diagrams", icon: DFDIcon },
  raci: { label: VIEW_KIND_LABELS.raci, noun: "RACI matrix", plural: "RACI matrices", icon: RACIIcon },
  decisiontree: { label: VIEW_KIND_LABELS.decisiontree, noun: "decision tree", plural: "Decision trees", icon: DecisionTreeIcon },
  statediagram: { label: VIEW_KIND_LABELS.statediagram, noun: "state diagram", plural: "State diagrams", icon: StateDiagramIcon },
  activity: { label: VIEW_KIND_LABELS.activity, noun: "activity diagram", plural: "Activity diagrams", icon: ActivityIcon },
};

/** "bmc" is the only viewKind backed by a BMCModel; every other viewKind
 *  (including the 5 new diagram types) is a lens over a ProcessModel. */
export function underlyingKind(vk: ViewKind): ArtifactKind {
  return vk === "bmc" ? "bmc" : "process";
}
