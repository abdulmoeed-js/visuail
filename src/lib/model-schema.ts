// Which shape of artifact model this build understands, and what happens in
// a tab that turns out to be older than the data it is looking at.
//
// A save replaces an artifact's whole model. A tab still running an older
// build reads the model through code that only knows the keys of its day
// (yjs-model.ts rebuilds the model key by key), so its next save would drop
// anything a newer build added -- a whole arrangement of shapes, say. So
// every model a newer build writes carries its schema number, every tab
// says which schema it runs when it announces itself on an artifact, and a
// tab that meets a higher number than its own stops editing until it is
// reloaded. That only protects tabs that run this code, so it has to be live
// for a while before the first build that raises the number.

import { useSyncExternalStore } from "react";

/** The model shape this build reads and writes in full. Raise it in the
 *  same change that adds a model key an older build would not keep. 1 is
 *  the shape from before the number existed; 2 will add `layouts` (hand-made
 *  arrangements, src/lib/canvas/layout.ts): the code reads and carries them
 *  already, and raising this to 2 is what starts saving them (SAVE_LAYOUTS).
 *  Not before 22 Oct 2026, once this guard has been live a few days. */
export const MODEL_SCHEMA = 1;

/** A model's schema; models written before the number existed are 1. */
export function schemaOf(model: { schema?: unknown } | null | undefined): number {
  const s = model?.schema;
  return typeof s === "number" && Number.isFinite(s) && s >= 1 ? Math.floor(s) : 1;
}

/** What the person is told wherever editing is refused for this reason. */
export const OUTDATED_TITLE = "Visu was updated while this page was open";
export const OUTDATED_DETAIL = "Reload the page to keep editing.";
/** Said where there is room: reloading loses nothing already saved. */
export const OUTDATED_SAFE = "Everything saved so far is safe.";

// One flag for the whole page: a build that is older than one artifact's
// data is older for all of them. Once set it stays set until a reload.
let outdated = false;
const listeners = new Set<() => void>();

/** True once this page has met data or a tab from a newer build. */
export function isOutdated(): boolean {
  return outdated;
}

/** Thrown by assertCurrent; friendlyError turns it into the reload message. */
export class OutdatedError extends Error {
  constructor() {
    super(OUTDATED_TITLE);
    this.name = "OutdatedError";
  }
}

/** Call right before writing artifacts to the database from page-level
 *  actions (re-check, add source, restore, versions, new artifact). Their
 *  buttons are already disabled once the page is out of date, but each runs
 *  for a while (a re-check reads every source again), and the page can turn
 *  out of date in the meantime. */
export function assertCurrent(): void {
  if (outdated) throw new OutdatedError();
}

/** Notes a schema number seen in a model or in another tab's announcement. */
export function noteSchema(schema: number): void {
  if (outdated || schema <= MODEL_SCHEMA) return;
  outdated = true;
  for (const l of listeners) l();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** The flag, for rendering. False during server rendering. */
export function useOutdated(): boolean {
  return useSyncExternalStore(subscribe, isOutdated, () => false);
}
