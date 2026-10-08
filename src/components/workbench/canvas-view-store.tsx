// In-memory view state for the canvases of ONE artifact: zoom and pan per
// view, plus anything else a canvas keeps locally and would otherwise lose
// (manual node positions, an open palette).
//
// Why it exists: ArtifactView renders one tab at a time, so switching from
// "Process map" to "RACI" and back unmounts the canvas. Without somewhere to
// park its state, the canvas came back re-fitted to a different zoom and with
// every hand-placed node snapped back to the auto layout.
//
// Scope is deliberately one ArtifactView mount: the provider sits inside it,
// so a different artifact (or a freshly extracted demo model, which remounts
// ArtifactView) starts clean and can never inherit another diagram's pan.
// Nothing here is persisted across a reload -- that would need the layout to
// live in the saved model, which is a separate piece of work.

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type Store = Map<string, unknown>;
const CanvasViewStoreCtx = createContext<Store | null>(null);

/** A store that lives as long as the component that calls this. For the
 *  owner of a provider that needs to read the store itself (ArtifactView's
 *  undo handler sits above its own provider). */
export function useNewCanvasViewStore(): Store {
  const ref = useRef<Store | null>(null);
  if (!ref.current) ref.current = new Map();
  return ref.current;
}

export function CanvasViewStoreProvider({
  store,
  children,
}: {
  store?: Store;
  children: ReactNode;
}) {
  const own = useNewCanvasViewStore();
  return <CanvasViewStoreCtx.Provider value={store ?? own}>{children}</CanvasViewStoreCtx.Provider>;
}

/** The surrounding artifact's store, or null when a canvas is rendered on its
 *  own (the project board, a test) -- callers must treat it as optional. */
export function useCanvasViewStore(): Store | null {
  return useContext(CanvasViewStoreCtx);
}

/** Holds the model as it was when the person last moved or resized something
 *  on a canvas. Undo covers the model only, not where shapes sit; while this
 *  note stands, the last thing done was a move, and the undo handler can say
 *  "that cannot be undone" instead of silently reverting an unrelated, older
 *  edit. ArtifactView drops the note whenever the model changes. */
export const LAYOUT_MOVED_KEY = "gesture:moved";

/** Returns a function a canvas calls, with its current model, whenever a drag
 *  or resize changes layout. */
export function useNoteLayoutMove(): (model: unknown) => void {
  const store = useContext(CanvasViewStoreCtx);
  return (model) => {
    store?.set(LAYOUT_MOVED_KEY, model);
  };
}

/** useState that survives the canvas unmounting on a tab switch. Behaves as a
 *  plain useState when no provider is present. */
export function useCanvasViewState<T>(
  key: string,
  initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const store = useContext(CanvasViewStoreCtx);
  const [value, setValue] = useState<T>(() => {
    if (store?.has(key)) return store.get(key) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  // Written after every commit, so the last value is already parked by the
  // time the component unmounts -- no unmount-time flush to get wrong.
  useEffect(() => {
    store?.set(key, value);
  }, [store, key, value]);
  return [value, setValue];
}
