// Per-item audit trail, derived from diffing consecutive project_snapshots
// (src/lib/session.ts) through the existing diffModels/allItems logic
// (src/lib/diff.ts, src/data/samples.ts) rather than a separate event-log
// table -- snapshots are the source of truth, this is a thin read-side view
// over them, not new write-side infrastructure.

import { allItems, type ArtifactModel, type BaseItem } from "@/data/samples";
import { diffModels } from "@/lib/diff";
import type { StoredCanvas, SnapshotTrigger } from "@/lib/session";

export interface AuditEvent {
  timestamp: number;
  trigger: SnapshotTrigger;
  description: string;
}

const REMOVED_SUFFIX = " (no longer in source)";

function itemsById(model: ArtifactModel): Map<string, BaseItem> {
  return new Map(allItems(model).map((i) => [i.id, i]));
}

/** Classifies every drifted item between two versions of the same canvas kind
 *  as added, changed, or removed. Reuses diffModels' item-level comparison;
 *  id-presence in the ORIGINAL (pre-diff) models is what distinguishes the
 *  three cases, since diffModels itself only marks drift, not why. */
function describeCanvasChanges(prevModel: ArtifactModel, nextModel: ArtifactModel): string[] {
  const prevById = itemsById(prevModel);
  const nextById = itemsById(nextModel);
  const diffed = diffModels(prevModel, nextModel);
  const events: string[] = [];

  for (const item of allItems(diffed)) {
    if (!item.drift) continue;
    if (item.text.endsWith(REMOVED_SUFFIX)) {
      const original = prevById.get(item.id);
      events.push(`"${original?.text ?? item.text.replace(REMOVED_SUFFIX, "")}" was removed`);
    } else if (!prevById.has(item.id)) {
      events.push(`"${item.text}" was added`);
    } else {
      const before = prevById.get(item.id);
      events.push(`"${before?.text}" changed to "${item.text}"`);
    }
  }
  return events;
}

/** One snapshot pair's worth of events, oldest-first input, newest change surfaced. */
function describeSnapshotPair(prev: StoredCanvas[], next: StoredCanvas[]): string[] {
  const events: string[] = [];
  for (const nextCanvas of next) {
    const prevCanvas = prev.find((c) => c.kind === nextCanvas.kind);
    if (!prevCanvas) {
      events.push(`${nextCanvas.kind === "process" ? "Process map" : "Business Model Canvas"} created`);
      continue;
    }
    events.push(...describeCanvasChanges(prevCanvas.model, nextCanvas.model));
  }
  return events;
}

/** Builds the full audit trail from an oldest-to-newest list of snapshots.
 *  The first snapshot has no prior version to diff against, so it's just
 *  reported as the starting point. */
export function buildAuditTrail(
  snapshots: { canvases: StoredCanvas[]; trigger: SnapshotTrigger; createdAt: number }[],
): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    if (i === 0) {
      events.push({ timestamp: s.createdAt, trigger: s.trigger, description: "Project created" });
      continue;
    }
    const changes = describeSnapshotPair(snapshots[i - 1].canvases, s.canvases);
    if (changes.length === 0) continue;
    for (const description of changes) {
      events.push({ timestamp: s.createdAt, trigger: s.trigger, description });
    }
  }
  return events.reverse(); // newest first, matching the version-history drawer's convention
}
