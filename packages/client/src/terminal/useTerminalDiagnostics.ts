import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { ScrollLockEvent, TerminalGrid } from "@kolu/xterm-kit/solid";

export type Renderer = "webgl" | "dom";

export interface ScrollLockDiagnostics {
  locked: boolean;
  pendingChunks: number;
  lastEvent: ScrollLockEvent | null;
}

export interface TerminalDiagnostics {
  id: TerminalId;
  term: TerminalGrid;
  wanted: TerminalGrid | null;
  renderer: Renderer;
  scrollLock: ScrollLockDiagnostics;
}

function scrollLockSnapshot(sl: {
  locked: Accessor<boolean>;
  pendingChunks: Accessor<number>;
  lastEvent: Accessor<ScrollLockEvent | null>;
}): ScrollLockDiagnostics {
  return {
    locked: sl.locked(),
    pendingChunks: sl.pendingChunks(),
    lastEvent: sl.lastEvent(),
  };
}

const [store, setStore] = createStore<Record<TerminalId, TerminalDiagnostics>>(
  {},
);

export function registerDiagnostics(
  id: TerminalId,
  {
    term,
    renderer,
    wanted,
    scrollLock,
  }: {
    term: Accessor<TerminalGrid>;
    renderer: Accessor<Renderer>;
    wanted: Accessor<TerminalGrid | null>;
    scrollLock: {
      locked: Accessor<boolean>;
      pendingChunks: Accessor<number>;
      lastEvent: Accessor<ScrollLockEvent | null>;
    };
  },
): () => void {
  setStore(id, {
    id,
    term: term(),
    wanted: wanted(),
    renderer: renderer(),
    scrollLock: scrollLockSnapshot(scrollLock),
  });

  const disposeRoot = createRoot((dispose) => {
    createEffect(() => {
      setStore(id, "renderer", renderer());
    });
    createEffect(() => {
      setStore(id, "term", term());
    });
    createEffect(() => {
      setStore(id, "wanted", wanted());
    });
    createEffect(() => {
      setStore(id, "scrollLock", scrollLockSnapshot(scrollLock));
    });
    return dispose;
  });

  return () => {
    disposeRoot();
    setStore(produce((s) => void delete s[id]));
  };
}

export function getDiagnostics(): TerminalDiagnostics[] {
  return Object.values(store);
}
