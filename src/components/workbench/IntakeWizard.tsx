// The IntakeWizard dialog component itself was superseded by the full-page
// /new route and the in-canvas AddSourceDialog (see SourceIntake.tsx); it was
// never rendered anywhere. This type is still shared by Workbench.tsx and
// ProjectView.tsx for the marketing-page single-source demo's "project mode".

import type { ArtifactModel } from "@/data/samples";
import type { ArtifactKind } from "@/lib/extract";

export interface ProjectResult {
  name: string;
  kinds: ArtifactKind[];
  sources: { label: string; text: string; origin: "paste" | "upload"; filename?: string }[];
  canvases: { kind: ArtifactKind; model: ArtifactModel }[];
}
