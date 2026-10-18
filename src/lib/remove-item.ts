// Deleting an item from an artifact model, including everything that pointed
// at it. Pure, so it can be checked on its own (remove-item.test.ts); used by
// delete and by the canvas's crash recovery in artifact-editing.ts.
//
// Items point at each other by id in several places -- a decision's branch
// targets, the step a decision follows, the step an exception or test case
// is about, a step's actor and system, a step's RACI codes, connections, the
// decision tree's branches. Removing only the item left all of those naming
// something that no longer exists: branches to nothing, decisions that fell
// to the bottom of the map, and decision-tree answers that vanished from the
// drawing while staying in the data.

import type { ArtifactModel, Decision, ProcessModel, RuleNode, Step } from "@/data/samples";
import { pruneLayouts } from "@/lib/canvas/layout";

/** What a branch target holds when it leads nowhere (see decisionBranches). */
export const NO_TARGET = "—";

/** The decision-tree nodes that go with `id` when it is deleted: the node
 *  and every answer under it, except any that another remaining question
 *  also leads to (those, and what is under them, stay). */
export function ruleSubtree(nodes: RuleNode[], id: string): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(id)) return new Set();
  const under = new Set<string>();
  const stack = [id];
  while (stack.length > 0) {
    const x = stack.pop()!;
    if (under.has(x)) continue;
    under.add(x);
    for (const b of byId.get(x)?.branches ?? []) if (byId.has(b.targetId)) stack.push(b.targetId);
  }
  // Kept: anything under it that a node outside the subtree also reaches.
  const kept = new Set<string>();
  const reach: string[] = [];
  for (const n of nodes) {
    if (under.has(n.id)) continue;
    for (const b of n.branches ?? []) if (under.has(b.targetId) && b.targetId !== id) reach.push(b.targetId);
  }
  while (reach.length > 0) {
    const x = reach.pop()!;
    if (x === id || kept.has(x)) continue;
    kept.add(x);
    for (const b of byId.get(x)?.branches ?? []) if (under.has(b.targetId)) reach.push(b.targetId);
  }
  return new Set([...under].filter((x) => !kept.has(x)));
}

/** Rebuilds only the items `fix` changes, so untouched items keep their
 *  identity (the shared document skips them without comparing fields). */
function mapChanged<T>(items: T[], fix: (item: T) => T): T[] {
  let changed = false;
  const out = items.map((item) => {
    const next = fix(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? out : items;
}

function cleanStep(s: Step, gone: Set<string>): Step {
  const actorGone = gone.has(s.actorId);
  const systemGone = s.systemId !== undefined && gone.has(s.systemId);
  const raciGone = !!s.raci && Object.keys(s.raci).some((k) => gone.has(k));
  if (!actorGone && !systemGone && !raciGone) return s;
  const next: Step = { ...s };
  // "" is the step's "nobody yet" (see onAddStep).
  if (actorGone) next.actorId = "";
  if (systemGone) delete next.systemId;
  if (raciGone && s.raci) {
    next.raci = Object.fromEntries(Object.entries(s.raci).filter(([k]) => !gone.has(k)));
  }
  return next;
}

function cleanDecision(d: Decision, gone: Set<string>, anchorFor: (stepId: string) => string): Decision {
  const anchorGone = gone.has(d.afterStepId);
  const branchGone = (d.branches ?? []).some((b) => gone.has(b.targetId));
  const yesGone = d.yes !== undefined && gone.has(d.yes);
  const noGone = d.no !== undefined && gone.has(d.no);
  if (!anchorGone && !branchGone && !yesGone && !noGone) return d;
  const next: Decision = { ...d };
  if (anchorGone) next.afterStepId = anchorFor(d.afterStepId);
  // The answer stays, with its label; it just no longer leads anywhere.
  if (branchGone) next.branches = d.branches.map((b) => (gone.has(b.targetId) ? { ...b, targetId: NO_TARGET } : b));
  if (yesGone) delete next.yes;
  if (noGone) delete next.no;
  return next;
}

function removeFromProcess(m: ProcessModel, id: string): ProcessModel {
  const tree = m.decisionTree ?? [];
  const gone = new Set([id, ...ruleSubtree(tree, id)]);

  // A decision that followed a deleted step moves up to the step before it,
  // so it stays where it was in the flow. The map draws one decision after
  // each step, so only if that step has none of its own: otherwise, or when
  // the first step went, it is left unanchored and drawn at the end, as an
  // unanchored decision always has been. (Moving it down to the next step
  // would put it after the step its own "Yes" leads to.)
  const stepIndex = m.steps.findIndex((s) => s.id === id);
  const taken = new Set(m.decisions.filter((d) => !gone.has(d.id) && !gone.has(d.afterStepId)).map((d) => d.afterStepId));
  const anchorFor = (stepId: string): string => {
    if (!gone.has(stepId)) return stepId;
    const before = stepIndex > 0 ? m.steps[stepIndex - 1].id : undefined;
    if (stepId !== id || !before || taken.has(before)) return "";
    taken.add(before);
    return before;
  };

  const keep = <T extends { id: string }>(items: T[]) => items.filter((x) => !gone.has(x.id));
  const unrelate = <T extends { relatedStepId?: string }>(x: T): T => {
    if (x.relatedStepId === undefined || !gone.has(x.relatedStepId)) return x;
    const next = { ...x };
    delete next.relatedStepId;
    return next;
  };

  return {
    ...m,
    actors: keep(m.actors),
    steps: mapChanged(keep(m.steps), (s) => cleanStep(s, gone)),
    decisions: mapChanged(keep(m.decisions), (d) => cleanDecision(d, gone, anchorFor)),
    exceptions: mapChanged(keep(m.exceptions), unrelate),
    systems: keep(m.systems),
    connections: (m.connections ?? []).filter((c) => !gone.has(c.fromId) && !gone.has(c.toId)),
    nonFunctionalRequirements: keep(m.nonFunctionalRequirements ?? []),
    testCases: mapChanged(keep(m.testCases ?? []), unrelate),
    dataStores: keep(m.dataStores ?? []),
    externalEntities: keep(m.externalEntities ?? []),
    // A question whose answer was deleted loses that branch: in a tree a
    // branch is only its arrow to the next node.
    decisionTree: mapChanged(keep(tree), (n) => (
      (n.branches ?? []).some((b) => gone.has(b.targetId))
        ? { ...n, branches: (n.branches ?? []).filter((b) => !gone.has(b.targetId)) }
        : n
    )),
    states: keep(m.states ?? []),
    layouts: pruneLayouts(m.layouts, gone),
  };
}

/** The model without the item `id`, wherever it lives, and with every
 *  reference to it removed or re-pointed (see the top of this file). For a
 *  decision-tree node, its answers go with it (ruleSubtree). */
export function removeById(m: ArtifactModel, id: string): ArtifactModel {
  const shared = {
    riskLog: (m.riskLog ?? []).filter((x) => x.id !== id),
    changeRequests: (m.changeRequests ?? []).filter((x) => x.id !== id),
    communicationPlan: (m.communicationPlan ?? []).filter((x) => x.id !== id),
    businessCase: m.businessCase && { ...m.businessCase, options: (m.businessCase.options ?? []).filter((x) => x.id !== id) },
  };
  if (m.kind === "process") return { ...removeFromProcess(m, id), ...shared };
  return {
    ...m, ...shared,
    blocks: m.blocks.map((b) => ({ ...b, items: b.items.filter((i) => i.id !== id) })),
    stakeholders: (m.stakeholders ?? []).filter((x) => x.id !== id),
    layouts: pruneLayouts(m.layouts, new Set([id])),
  };
}
