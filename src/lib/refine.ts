// Deterministic "AI-assisted refinement" for the workbench process map.
// No real LLM call — a keyword-matched, transparent transform that produces a
// Proposal (diff-style) which the user explicitly accepts or rejects before it
// touches the underlying IR.

import type { ProcessModel, Step, Decision, Exception } from "@/data/samples";

export type NodeKind = "step" | "decision" | "exception";

export type Proposal =
  | {
      kind: "rewrite";
      targetKind: NodeKind;
      targetId: string;
      before: string;
      after: string;
      lowConfidence?: boolean;
      note: string;
    }
  | {
      kind: "split";
      targetId: string;
      before: string;
      afterA: string;
      afterB: string;
      note: string;
    }
  | {
      kind: "addException";
      anchorStepId: string;
      anchorText: string;
      text: string;
      note: string;
    }
  | {
      kind: "insertApproval";
      anchorStepId: string;
      anchorText: string;
      approver: string;
      newDecisionText: string;
      note: string;
    }
  | {
      kind: "mergeWithNext";
      targetId: string;
      nextId: string;
      beforeA: string;
      beforeB: string;
      after: string;
      note: string;
    };

// Best-effort split of a step's action text into two sequential clauses.
function splitText(t: string): [string, string] {
  const conj = t.match(/^(.+?)\s+(?:and then|then|and|,|—|·|;)\s+(.+)$/i);
  if (conj) return [conj[1].trim().replace(/[,;·—]+$/, ""), conj[2].trim()];
  const words = t.split(/\s+/);
  if (words.length < 2) return [t, t];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

function extractAfter(prompt: string, marker: RegExp): string | null {
  const m = prompt.match(marker);
  if (!m) return null;
  const tail = prompt.slice((m.index ?? 0) + m[0].length).trim();
  return tail || null;
}

/**
 * Parse the free-text prompt into a concrete Proposal against the selected node.
 * Falls back to a low-confidence rewrite so the demo never dead-ends.
 */
export function proposeRefinement(
  node: { id: string; kind: NodeKind; text: string },
  model: ProcessModel,
  rawPrompt: string,
): Proposal | null {
  const prompt = rawPrompt.trim();
  if (!prompt) return null;
  const p = prompt.toLowerCase();

  // Steps support the richest set of refinements
  if (node.kind === "step") {
    if (/(split (this |it |the (step|action) )?into two|split (into )?two steps?|break (this |it )?(step |action )?(in|into) two)/i.test(p)) {
      const [a, b] = splitText(node.text);
      return {
        kind: "split",
        targetId: node.id,
        before: node.text,
        afterA: a,
        afterB: b,
        note: "Split into two sequential steps at a natural clause boundary. New steps inherit actor and system from the original.",
      };
    }

    if (/(merge (with )?next|combine (with )?next( step)?|merge into next)/i.test(p)) {
      const idx = model.steps.findIndex((s) => s.id === node.id);
      const next = idx >= 0 ? model.steps[idx + 1] : undefined;
      if (!next) {
        return {
          kind: "rewrite",
          targetKind: "step",
          targetId: node.id,
          before: node.text,
          after: node.text,
          lowConfidence: true,
          note: "No next step to merge with — this is the last step on the spine.",
        };
      }
      return {
        kind: "mergeWithNext",
        targetId: node.id,
        nextId: next.id,
        beforeA: node.text,
        beforeB: next.text,
        after: `${node.text} · ${next.text}`,
        note: `Combine ${node.id} and ${next.id} into a single step. Decisions/exceptions pointing at ${next.id} will re-anchor to ${node.id}.`,
      };
    }

    if (/(add (an? )?exception|except(ion)?( for)?)/i.test(p)) {
      const detail =
        extractAfter(prompt, /(add (an? )?exception (for )?|exception for |except(ion)? for )/i) ??
        prompt.replace(/(add (an? )?exception|exception|except(ion)?)/i, "").trim();
      const text = detail && detail.length > 0
        ? detail[0].toUpperCase() + detail.slice(1)
        : "Unhandled exception path";
      return {
        kind: "addException",
        anchorStepId: node.id,
        anchorText: node.text,
        text,
        note: `New exception item linked to ${node.id}. It will render in the right-hand exception corridor.`,
      };
    }

    if (/(require (an? )?approval|needs? approval|add (an? )?approval)/i.test(p)) {
      const approver =
        extractAfter(prompt, /(approval (from|by) |approval: |approve[dr]? by )/i) ??
        "approver";
      const clean = approver.replace(/[.!?]+$/, "").trim() || "approver";
      return {
        kind: "insertApproval",
        anchorStepId: node.id,
        anchorText: node.text,
        approver: clean,
        newDecisionText: `Approved by ${clean}?`,
        note: `Insert a decision node right after ${node.id}. "yes" continues on the spine; "no" branches to rework.`,
      };
    }
  }

  // Fallback: direct rewrite, flagged as low-confidence best-effort so the user
  // knows the demo didn't recognize a canonical pattern.
  return {
    kind: "rewrite",
    targetKind: node.kind,
    targetId: node.id,
    before: node.text,
    after: prompt[0].toUpperCase() + prompt.slice(1),
    lowConfidence: true,
    note: "Prompt didn't match a known refinement pattern. Applying as a direct rewrite of the node's text — review carefully before accepting.",
  };
}

// ---- ID minting ----

function nextIdFor(model: ProcessModel, prefix: "ST" | "DC" | "EX"): string {
  const list =
    prefix === "ST" ? model.steps : prefix === "DC" ? model.decisions : model.exceptions;
  const taken = new Set(list.map((x) => x.id));
  // also avoid collisions with any user-added IDs elsewhere
  let n = list.length + 1;
  while (taken.has(`${prefix}${n}`) || taken.has(`${prefix}-R${n}`)) n++;
  return `${prefix}-R${n}`;
}

function marked(base: Partial<Step & Decision & Exception>): Partial<Step & Decision & Exception> {
  return { ...base, confidence: 1, userAdded: true, drift: false, unresolved: false };
}

/**
 * Apply a Proposal to the model. Returns a new ProcessModel — pure function so
 * the caller decides when to commit. New items are marked userAdded/confidence=1
 * to match the manual-edit treatment.
 */
export function applyProposal(p: Proposal, model: ProcessModel): ProcessModel {
  switch (p.kind) {
    case "rewrite": {
      const patch = (arr: (Step | Decision | Exception)[]) =>
        arr.map((x) =>
          x.id === p.targetId
            ? ({ ...x, text: p.after, confidence: 1, userAdded: true, drift: false, unresolved: false } as typeof x)
            : x,
        );
      if (p.targetKind === "step") return { ...model, steps: patch(model.steps) as Step[] };
      if (p.targetKind === "decision") return { ...model, decisions: patch(model.decisions) as Decision[] };
      return { ...model, exceptions: patch(model.exceptions) as Exception[] };
    }

    case "split": {
      const idx = model.steps.findIndex((s) => s.id === p.targetId);
      if (idx < 0) return model;
      const orig = model.steps[idx];
      const newIdA = orig.id; // keep original id on first half so downstream refs stay stable
      const newIdB = nextIdFor(model, "ST");
      const a: Step = { ...orig, text: p.afterA, ...(marked({}) as Partial<Step>) };
      const b: Step = {
        id: newIdB,
        text: p.afterB,
        actorId: orig.actorId,
        systemId: orig.systemId,
        ...(marked({}) as Partial<Step>),
      } as Step;
      const steps = [...model.steps.slice(0, idx), a, b, ...model.steps.slice(idx + 1)];
      return { ...model, steps };
    }

    case "addException": {
      const id = nextIdFor(model, "EX");
      const ex: Exception = {
        id,
        text: p.text,
        relatedStepId: p.anchorStepId,
        ...(marked({}) as Partial<Exception>),
      } as Exception;
      return { ...model, exceptions: [...model.exceptions, ex] };
    }

    case "insertApproval": {
      const id = nextIdFor(model, "DC");
      const idx = model.steps.findIndex((s) => s.id === p.anchorStepId);
      const nextStep = idx >= 0 ? model.steps[idx + 1] : undefined;
      const dec: Decision = {
        id,
        text: p.newDecisionText,
        afterStepId: p.anchorStepId,
        yes: nextStep?.id ?? "—",
        no: "rework",
        ...(marked({}) as Partial<Decision>),
      } as Decision;
      return { ...model, decisions: [...model.decisions, dec] };
    }

    case "mergeWithNext": {
      const idx = model.steps.findIndex((s) => s.id === p.targetId);
      if (idx < 0 || idx >= model.steps.length - 1) return model;
      const orig = model.steps[idx];
      const removedId = p.nextId;
      const merged: Step = { ...orig, text: p.after, ...(marked({}) as Partial<Step>) };
      const steps = model.steps.filter((_, i) => i !== idx && i !== idx + 1);
      steps.splice(idx, 0, merged);
      // Re-anchor decisions/exceptions that pointed to the removed step id.
      const decisions = model.decisions.map((d) => ({
        ...d,
        afterStepId: d.afterStepId === removedId ? orig.id : d.afterStepId,
        yes: d.yes === removedId ? orig.id : d.yes,
        no: d.no === removedId ? orig.id : d.no,
      }));
      const exceptions = model.exceptions.map((e) => ({
        ...e,
        relatedStepId: e.relatedStepId === removedId ? orig.id : e.relatedStepId,
      }));
      return { ...model, steps, decisions, exceptions };
    }
  }
}

/** Short human-readable summary for the proposal card header. */
export function proposalHeadline(p: Proposal): string {
  switch (p.kind) {
    case "rewrite":
      return p.lowConfidence ? "Best-effort rewrite" : "Rewrite text";
    case "split":
      return "Split into two steps";
    case "addException":
      return "Add exception";
    case "insertApproval":
      return "Insert approval decision";
    case "mergeWithNext":
      return "Merge with next step";
  }
}
