/// <reference types="node" />
import { test } from "node:test";
import assert from "node:assert/strict";
import { editorOf, type Peer } from "./artifact-channel";

const peer = (tabId: string, openedAt: number, extra: Partial<Peer> = {}): Peer => ({
  tabId, userId: "u", email: "a@b.c", openedAt, claimedAt: null, schema: 1, lastSeen: 0, ...extra,
});

test("the first tab to open edits, unless a later one took over", () => {
  assert.equal(editorOf([]), null);
  assert.equal(editorOf([peer("b", 20), peer("a", 10)])!.tabId, "a");
  assert.equal(editorOf([peer("a", 10), peer("b", 20, { claimedAt: 30 })])!.tabId, "b");
  assert.equal(editorOf([peer("a", 10, { claimedAt: 40 }), peer("b", 20, { claimedAt: 30 })])!.tabId, "a");
  // Same moment: decided by tab id, the same way in every tab.
  assert.equal(editorOf([peer("z", 10), peer("m", 10)])!.tabId, "m");
});

test("a tab on an older schema never edits next to a newer one", () => {
  const old = peer("old", 10, { schema: 1 });
  const fresh = peer("new", 20, { schema: 2 });
  assert.equal(editorOf([old, fresh])!.tabId, "new");
  // Not even when it pressed Take over.
  assert.equal(editorOf([{ ...old, claimedAt: 99 }, fresh])!.tabId, "new");
  // Among the newest, the usual rule.
  assert.equal(editorOf([old, fresh, peer("new2", 15, { schema: 2 })])!.tabId, "new2");
  // Alone, an older tab is still the editor as far as the list goes (the
  // page itself refuses edits once it has seen newer data).
  assert.equal(editorOf([old])!.tabId, "old");
});
