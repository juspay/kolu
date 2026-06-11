/** Per-terminal live observable state — the volatility axis this module
 *  encapsulates is "per-terminal runtime facts that a UI needs to observe
 *  reactively." Current consumers: the Diagnostic Info dialog. Future
 *  consumers (e.g. a dev inspector) read through the same snapshot.
 *
 *  Rule for adding new fields: this module is for **per-terminal,
 *  live-subscribed facts only**. Session-wide facts (WS status, terminal
 *  count) belong in `useViewState` or similar. One-shot facts read at
 *  dialog-open time (user agent, memory snapshot) belong in the consumer.
 *
 *  Separation from `terminalRefs`: `terminalRefs` is an imperative Map
 *  for handlers that grab xterm/addons on demand; this is a reactive
 *  store for UI subscription. Same lifecycle, different volatility axes
 *  — both registrations happen in Terminal.tsx onMount/onCleanup. */

import type { Terminal as XTerm } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { ScrollLockEvent } from "../scrollLock";

export type Renderer = "webgl" | "dom";

/** Live scroll-lock state per terminal — whether output is currently being
 *  held instead of painted, how much, and the transition that engaged it
 *  (#1272 field diagnosis). */
export interface ScrollLockDiagnostics {
  locked: boolean;
  pendingChunks: number;
  lastEvent: ScrollLockEvent | null;
}

export interface TerminalDiagnostics {
  id: TerminalId;
  cols: number;
  rows: number;
  renderer: Renderer;
  scrollLock: ScrollLockDiagnostics;
}

const [store, setStore] = createStore<Record<TerminalId, TerminalDiagnostics>>(
  {},
);

/** Register per-terminal diagnostic tracking. `renderer` is an accessor
 *  so the caller's signal stays the single source of truth — any code
 *  path that flips the renderer in Terminal.tsx is reflected here
 *  automatically, no imperative updater to forget.
 *
 *  Returns a cleanup function to call from `onCleanup`. */
export function registerDiagnostics(
  id: TerminalId,
  {
    xterm,
    renderer,
    scrollLock,
  }: {
    xterm: XTerm;
    renderer: Accessor<Renderer>;
    scrollLock: {
      locked: Accessor<boolean>;
      pendingChunks: Accessor<number>;
      lastEvent: Accessor<ScrollLockEvent | null>;
    };
  },
): () => void {
  setStore(id, {
    id,
    cols: xterm.cols,
    rows: xterm.rows,
    renderer: renderer(),
    scrollLock: {
      locked: scrollLock.locked(),
      pendingChunks: scrollLock.pendingChunks(),
      lastEvent: scrollLock.lastEvent(),
    },
  });

  const resizeDisposable = xterm.onResize(({ cols, rows }) => {
    setStore(id, { cols, rows });
  });

  // Own the effect root explicitly so the subscription is torn down with
  // the terminal, not at the component's Solid owner (Terminal.tsx passes
  // the accessor as a closure; if the component disposes first there'd
  // be a stale read).
  const disposeRoot = createRoot((dispose) => {
    createEffect(() => {
      setStore(id, "renderer", renderer());
    });
    createEffect(() => {
      setStore(id, "scrollLock", {
        locked: scrollLock.locked(),
        pendingChunks: scrollLock.pendingChunks(),
        lastEvent: scrollLock.lastEvent(),
      });
    });
    return dispose;
  });

  return () => {
    resizeDisposable.dispose();
    disposeRoot();
    setStore(produce((s) => void delete s[id]));
  };
}

/** Reactive snapshot of all registered terminals. Consumers that render
 *  per-field only pay the re-render cost for the field they read, thanks
 *  to `createStore`'s fine-grained tracking. */
export function getDiagnostics(): TerminalDiagnostics[] {
  return Object.values(store);
}
