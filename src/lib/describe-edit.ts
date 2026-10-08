// Plain-words account of what changed between two versions of a model.
//
// Undo and redo act on the whole artifact, and the change they make is often
// not on screen: the edit being reversed may live in another tab, or below
// the visible part of a canvas. Without saying what happened, Ctrl/Cmd+Z is
// a button that sometimes appears to do nothing and sometimes quietly removes
// something the person cannot see. This names the thing that changed.
//
// It works on the model as plain data (anything with a string `id`), so a new
// kind of item is described without this file having to hear about it.

/** What each list in a model holds, in the singular. */
const NOUNS: Record<string, string> = {
  actors: "actor",
  steps: "step",
  decisions: "decision",
  exceptions: "exception",
  systems: "system",
  connections: "connection",
  branches: "branch",
  nonFunctionalRequirements: "requirement",
  testCases: "test case",
  dataStores: "data store",
  externalEntities: "external entity",
  decisionTree: "rule",
  states: "state",
  riskLog: "risk",
  changeRequests: "change request",
  communicationPlan: "communication item",
  stakeholders: "stakeholder",
  options: "option",
};

interface Entry {
  id: string;
  noun: string;
  label: string;
  /** The item's own fields, serialised -- lists of further items left out, so
   *  a change to a child is reported as the child's, not also the parent's. */
  own: string;
  /** The item this one lives inside (a branch's decision), if any. */
  parent: string | null;
  /** For a connection: the two items it joins. */
  ends: string[];
}

/** Flags the app sets on items as bookkeeping, not content. A drift re-check
 *  stamps these across the whole model; counting them made "two steps
 *  changed" read as "20 items changed". */
const BOOKKEEPING = new Set(["drift", "conflict", "conflictNote", "blockDrift", "driftNote"]);

/** Parts of a model that are documents rather than lists of items, so an
 *  edit to one has no item to name. Named as a whole instead. */
const DOCUMENTS: Record<string, string> = {
  businessCase: "Business case",
  requirementsManagementPlan: "Requirements plan",
};

const isItem = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  typeof (v as { id?: unknown }).id === "string";

const holdsItems = (v: unknown) => Array.isArray(v) && v.some(isItem);

function clip(text: string, max = 48): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function indexItems(model: unknown): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const visit = (value: unknown, key: string, depth: number, parent: string | null) => {
    if (depth > 8 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, key, depth + 1, parent);
      return;
    }
    const obj = value as Record<string, unknown>;
    let inside = parent;
    if (depth > 0 && isItem(obj)) {
      const id = obj.id as string;
      const own: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj))
        if (!holdsItems(v) && !BOOKKEEPING.has(k)) own[k] = v;
      const name = [obj.text, obj.label, obj.name, obj.title].find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      );
      // Keyed under the parent: sibling lists reuse ids (every extracted
      // decision has branches "s0-yes" and "s0-no"), and a bare id would let
      // one decision's branches overwrite another's.
      out.set(parent ? `${parent}/${id}` : id, {
        id,
        noun: NOUNS[key] ?? "item",
        label: name ? clip(name) : "",
        own: JSON.stringify(own),
        parent,
        ends:
          key === "connections"
            ? [obj.fromId, obj.toId].filter((v): v is string => typeof v === "string")
            : [],
      });
      inside = id;
    }
    for (const [k, v] of Object.entries(obj)) visit(v, k, depth + 1, inside);
  };
  visit(model, "", 0, null);
  return out;
}

const plural = (noun: string) =>
  noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : noun.endsWith("ch") ? `${noun}es` : `${noun}s`;

const one = (e: Entry) =>
  e.label ? `${e.noun} “${e.label}”` : `${/^[aeiou]/.test(e.noun) ? "an" : "a"} ${e.noun}`;

/** "step “Review order”", "actor “Ops” and step “Review order”", "3 steps". */
function phrase(entries: Entry[]): string | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) return one(entries[0]);
  if (entries.length === 2) return `${one(entries[0])} and ${one(entries[1])}`;
  const same = entries.every((e) => e.noun === entries[0].noun);
  return `${entries.length} ${same ? plural(entries[0].noun) : "items"}`;
}

export interface EditSummary {
  /** Items present after the change that were not there before. */
  added: string | null;
  /** Items there before the change and gone after it. */
  removed: string | null;
  /** Items in both whose own content differs -- or, when no item changed, the
   *  document that did ("Business case"). */
  changed: string | null;
  /** Set by the caller for an action better named than described: a source
   *  re-check touches flags all over the model and is one thing to the person. */
  label?: string;
}

/** What came or went as a consequence of something else in the same list
 *  coming or going: a decision's branches, the connections of a deleted step.
 *  The person added or removed ONE thing; that is what gets named. */
function headline(entries: Entry[]): Entry[] {
  const ids = new Set(entries.map((e) => e.id));
  return entries.filter(
    (e) => !(e.parent && ids.has(e.parent)) && !e.ends.some((end) => ids.has(end)),
  );
}

/** Which document-like part of the model differs, if any. */
function changedDocument(from: unknown, to: unknown): string | null {
  if (!from || !to || typeof from !== "object" || typeof to !== "object") return null;
  const strip = (v: unknown) =>
    JSON.stringify(v, (_k, val) => (holdsItems(val) ? undefined : val)) ?? "";
  for (const [key, name] of Object.entries(DOCUMENTS)) {
    const a = (from as Record<string, unknown>)[key];
    const b = (to as Record<string, unknown>)[key];
    if (strip(a) !== strip(b)) return name;
  }
  return null;
}

/** What going from `from` to `to` does, item by item. */
export function summariseEdit(from: unknown, to: unknown): EditSummary {
  const a = indexItems(from);
  const b = indexItems(to);
  const added: Entry[] = [];
  const removed: Entry[] = [];
  const changed: Entry[] = [];
  for (const [id, e] of b) {
    const before = a.get(id);
    if (!before) added.push(e);
    else if (before.own !== e.own) changed.push(e);
  }
  for (const [id, e] of a) if (!b.has(id)) removed.push(e);
  return {
    added: phrase(headline(added)),
    removed: phrase(headline(removed)),
    changed: phrase(changed) ?? changedDocument(from, to),
  };
}

/** One line for the notice shown after an undo or redo, describing the effect
 *  the person can now see: "Undo: step “Review order” removed". */
export function historyNotice(direction: "undo" | "redo", s: EditSummary): string {
  const undo = direction === "undo";
  if (s.label)
    return `${undo ? "Undo" : "Redo"}: ${s.label} ${undo ? "taken back" : "applied again"}`;
  const parts: string[] = [];
  if (s.removed) parts.push(`${s.removed} removed`);
  if (s.added) parts.push(`${s.added} ${undo ? "restored" : "added"}`);
  // Adding or removing an item usually adjusts its neighbours too (what a
  // decision follows, what a branch points at). Those are consequences, not
  // news; a change is only worth naming when it is the whole of the edit.
  if (parts.length === 0 && s.changed)
    parts.push(`${s.changed} ${undo ? "changed back" : "changed"}`);
  const body = parts.length > 0 ? parts.join(", ") : undo ? "last edit reversed" : "edit reapplied";
  return `${undo ? "Undo" : "Redo"}: ${body}`;
}
