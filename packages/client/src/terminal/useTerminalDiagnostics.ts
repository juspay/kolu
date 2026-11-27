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
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createStore,
  runWithOwner,
} from "solid-js";
import { sameItems } from "../conductor/sameItems";
import { foldEach } from "@kolu/surface/solid";
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
  // DETACHED for the one synchronous write: `registerDiagnostics` is called
  // from `Terminal.tsx`'s `onReady`, which the kit runs inside the pane's own
  // owner — an OWNED scope, where a store setter is
  // REACTIVE_WRITE_IN_OWNED_SCOPE and THROWS in a development build. A store
  // setter has no `ownedWrite` to declare, so detaching the owner is the hatch.
  // (`detachedRoot.ts` detaches too, but for an unrelated reason: the lifetime
  // of what it creates, not the legality of a write.) It costs nothing: this
  // registry is app-global state rather than the caller's reactive state, and
  // nothing in here registers a cleanup.
  runWithOwner(null, () =>
    setStore((s) => {
      const held = s[id];
      if (held) Object.assign(held, registered);
      else s[id] = registered;
    }),
  );
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

/** Whether two readings of one terminal's diagnostics say the same thing. The
 *  row memos below mint a fresh record per run, so this is what keeps an
 *  untouched terminal's row — and the published list — still. */
function sameDiagnostics(
  a: TerminalDiagnostics,
  b: TerminalDiagnostics,
): boolean {
  return (
    a.id === b.id &&
    a.term.cols === b.term.cols &&
    a.term.rows === b.term.rows &&
    a.wanted?.cols === b.wanted?.cols &&
    a.wanted?.rows === b.wanted?.rows &&
    (a.wanted === null) === (b.wanted === null) &&
    a.renderer === b.renderer &&
    a.scrollLock.locked === b.scrollLock.locked &&
    a.scrollLock.pendingChunks === b.scrollLock.pendingChunks &&
    a.scrollLock.lastEvent === b.scrollLock.lastEvent
  );
}

/** THE REGISTER, READ ONE TERMINAL AT A TIME.
 *
 *  `Object.values(store)` handed back the store's own records, so a consumer
 *  that read a field off each of them — the Diagnostic dialog's dump, and the
 *  terminal count in its own render effect — took the container plus a leaf
 *  per field per terminal on ITS scope: eight to twelve per pane, past Solid's
 *  200-source `WIDE_SCOPE_DEPS` judge at about twenty terminals. The cost
 *  belongs here, where it can be paid once and split: `Object.keys` of a store
 *  is the container node ALONE (one source at any size), each terminal gets a
 *  row memo holding its own leaves, and the rows are joined a chunk at a time.
 *  So every consumer below reads ONE source and PLAIN records.
 *
 *  An app-lifetime root, like the register itself: these memos outlive every
 *  terminal and every dialog that reads them. */
const registered = createRoot(() => {
  const ids = createMemo(() => Object.keys(store) as TerminalId[], {
    name: "terminalDiagnostics.ids",
    equals: sameItems,
  });
  return foldEach(
    "terminalDiagnostics",
    ids,
    (id): TerminalDiagnostics | undefined => {
      const entry = store[id];
      if (entry === undefined) return undefined;
      return {
        id: entry.id,
        term: { cols: entry.term.cols, rows: entry.term.rows },
        wanted:
          entry.wanted === null
            ? null
            : { cols: entry.wanted.cols, rows: entry.wanted.rows },
        renderer: entry.renderer,
        scrollLock: {
          locked: entry.scrollLock.locked,
          pendingChunks: entry.scrollLock.pendingChunks,
          // The ring's events are replaced whole, never edited, so the latest
          // one rides by reference: a reader of its fields is that reader's own
          // narrow scope, and an unchanged event keeps this row still.
          lastEvent: entry.scrollLock.lastEvent,
        },
      };
    },
    sameDiagnostics,
  );
});

/** Reactive snapshot of all registered terminals, as PLAIN records: ONE source
 *  for the whole list, whatever a consumer reads off it. */
export function getDiagnostics(): readonly TerminalDiagnostics[] {
  return registered();
}
