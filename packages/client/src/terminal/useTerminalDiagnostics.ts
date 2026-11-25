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
 *  — both registrations happen in Terminal.tsx at mount and teardown. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createRoot, createStore } from "solid-js";
import type { ScrollLockEvent, TerminalGrid } from "@kolu/xterm-kit/solid";

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
  /** The size the terminal IS — what the bytes in its buffer are laid out for.
   *  Moves only when the attach stream says the pty's mirror moved. */
  term: TerminalGrid;
  /** The size this pane's BOX can hold, and has asked the pty for — `null`
   *  until the pane has measured its own box at all, which is also "no attach
   *  stream has opened yet". The two grids differ for a settle window plus a
   *  round trip after any box change, and a dialog showing only one of them
   *  cannot explain a terminal that looks a row short. */
  wanted: TerminalGrid | null;
  renderer: Renderer;
  scrollLock: ScrollLockDiagnostics;
}

/** Project the three live scroll-lock accessors into a flat snapshot. The
 *  {locked, pendingChunks, lastEvent} shape lives here only, so the initial
 *  paint and the live effect can never silently diverge. */
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

/** Register per-terminal diagnostic tracking. `renderer` is an accessor
 *  so the caller's signal stays the single source of truth — any code
 *  path that flips the renderer in Terminal.tsx is reflected here
 *  automatically, no imperative updater to forget.
 *
 *  Returns a cleanup function to call from `onCleanup`. */
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
  const registered: TerminalDiagnostics = {
    id,
    term: term(),
    wanted: wanted(),
    renderer: renderer(),
    scrollLock: scrollLockSnapshot(scrollLock),
  };
  setStore((s) => {
    const held = s[id];
    if (held) Object.assign(held, registered);
    else s[id] = registered;
  });
  /** Write this terminal's registered entry in place. */
  const write = (edit: (entry: TerminalDiagnostics) => void): void =>
    setStore((s) => {
      const entry = s[id];
      if (!entry) throw new Error(`diagnostics: ${id} is not registered`);
      edit(entry);
    });

  // Own the effect root explicitly so the subscription is torn down with
  // the terminal, not at the component's Solid owner (Terminal.tsx passes
  // the accessor as a closure; if the component disposes first there'd
  // be a stale read). A grid or snapshot is merged into the one it replaces,
  // so a reader of one field is not woken by another's write.
  const disposeRoot = createRoot((dispose) => {
    createEffect(renderer, (next) => {
      write((entry) => {
        entry.renderer = next;
      });
    });
    createEffect(term, (next) => {
      write((entry) => {
        Object.assign(entry.term, next);
      });
    });
    createEffect(wanted, (next) => {
      write((entry) => {
        if (entry.wanted && next) Object.assign(entry.wanted, next);
        else entry.wanted = next;
      });
    });
    createEffect(
      () => scrollLockSnapshot(scrollLock),
      (next) => {
        write((entry) => {
          Object.assign(entry.scrollLock, next);
        });
      },
    );
    return dispose;
  });

  return () => {
    disposeRoot();
    setStore((s) => {
      delete s[id];
    });
  };
}

/** Reactive snapshot of all registered terminals. Consumers that render
 *  per-field only pay the re-render cost for the field they read, thanks
 *  to `createStore`'s fine-grained tracking. */
export function getDiagnostics(): TerminalDiagnostics[] {
  return Object.values(store);
}
