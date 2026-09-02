// Derives a Use Case Diagram's actor/use-case grouping straight from an
// existing ProcessModel -- no new stored fields, no user input required.
// One oval per step (not clustered) so slice 2's drill-down can key off the
// same step id the diagram renders.

import { decisionBranches, type Actor, type Decision, type Exception, type ProcessModel, type Step } from "@/data/samples";

export interface UseCase {
  id: string;
  step: Step;
  actorId: string;
  title: string;
}

export interface ActorUseCases {
  actor: Actor;
  useCases: UseCase[];
}

export function useCasesByActor(model: ProcessModel): ActorUseCases[] {
  return model.actors
    .map((actor) => ({
      actor,
      useCases: model.steps
        .filter((s) => s.actorId === actor.id)
        .map((step) => ({ id: step.id, step, actorId: actor.id, title: step.text })),
    }))
    .filter((g) => g.useCases.length > 0);
}

export interface AlternateFlow {
  decision: Decision;
  branch: string;
  targetLabel: string;
}

export interface UseCaseDescriptionDraft {
  step: Step;
  actor: Actor | undefined;
  basicFlow: string[];
  alternateFlows: AlternateFlow[];
  exceptionFlows: Exception[];
}

/** A step's own text plus the model relationships that already point at it,
 *  reshaped into the classic use-case-description sections. Pre/post-condition
 *  aren't derivable and are edited directly on the step (see UseCaseDescriptionDialog). */
export function deriveUseCaseDescription(model: ProcessModel, stepId: string): UseCaseDescriptionDraft | undefined {
  const step = model.steps.find((s) => s.id === stepId);
  if (!step) return undefined;
  const actor = model.actors.find((a) => a.id === step.actorId);

  const targetLabel = (targetId: string) =>
    model.steps.find((s) => s.id === targetId)?.text
    ?? model.exceptions.find((e) => e.id === targetId)?.text
    ?? targetId;

  const alternateFlows: AlternateFlow[] = model.decisions
    .filter((d) => d.afterStepId === stepId)
    .flatMap((decision) => decisionBranches(decision).map((b) => ({
      decision, branch: b.label, targetLabel: targetLabel(b.targetId),
    })));

  const exceptionFlows = model.exceptions.filter((e) => e.relatedStepId === stepId);

  return { step, actor, basicFlow: [step.text], alternateFlows, exceptionFlows };
}
