// Where an item came from, read off its id.
//
// Ids the person creates in the app are minted by nextId() in
// artifact-editing.ts as `${prefix}-U${n}` (ST-U1001, AC-U1004). Ids from an
// extraction are whatever the model chose, prefixed with their source:
// `s0-ST1`. The `userAdded` flag cannot answer the question on its own: it is
// also set when someone merely rewords an extracted item, or accepts a
// refinement. So "did a person create this?" is asked of the id, here, in one
// place.
//
// The source prefix is ruled out explicitly: nothing stops an extraction from
// calling an item "U1" or "R1", and `s0-U1` must not read as hand-made.
const fromSource = (id: string): boolean => /^s\d+-/.test(id);

export const isUserCreatedId = (id: string): boolean => /-U\d+$/.test(id) && !fromSource(id);

// Items an accepted refinement creates (a new exception, an approval gate,
// the second half of a split step) are minted by refine.ts as
// `${prefix}-R${n}`. Nobody typed them and no source stated them as such, so
// they are neither "added by hand" nor "extracted, then edited".
export const isRefinementId = (id: string): boolean => /-R\d+$/.test(id) && !fromSource(id);
