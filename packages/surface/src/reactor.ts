/**
 * `reactor.ts` — the reactive bridge, phase 0.
 *
 * State is a signal; derived state is a computed; **the wire is a signal
 * boundary that snapshots and replays.** This module is the ONE exit from the
 * backend signal graph into `@kolu/surface`'s cell machinery. A signals engine
 * (`@preact/signals-core` today; `@solidjs/signals` the named swap target) is a
 * dependency of `@kolu/surface` ONLY, wrapped HERE and nowhere else — the
 * engine's deep import is lint-banned outside this file (`biome.jsonc`), so this
 * wrapper is the graph's only exit by construction, not by review.
 *
 * Phase 0 exports exactly three symbols — `source`, `scan`, and `derived.cell`
 * — the minimum W5 needs (drishti's `alerts` cell is their first consumer). The
 * `$` sibling-read face, `computed`, `batch`, and `derived.collection` are later
 * phases; the full model, laws, and worked examples live in the reactive-bridge
 * note (`docs/atlas/.../surface-reactive-bridge.mdx`).
 *
 * Three guarantees ride phase 0:
 *   - **one writer, structural** — a `derived.cell(...)` dep is branded so the
 *     boot walk enforces wire-read-only (no `set`/`patch`/`test__set`); the
 *     graph is the member's only writer.
 *   - **dedup at the member's `equals`, once** — a derived value flows through
 *     the SAME `equals → onWrite → store.set → bus.publish` gate every cell
 *     write uses (the `connect` seam), so nothing new is added to the wire dedup
 *     point.
 *   - **mirrors never fabricate** — a derived cell seeds from its graph node's
 *     current level by an eager pull at wiring (a throw is a boot crash), never
 *     a fabricated default served before the truth exists.
 *
 * **Streams and events deliberately do NOT ride the graph.** A signal is state,
 * not a log — it conflates same-batch frames by construction; a stream must see
 * every frame. This is a permanent boundary, not a phase gap.
 */

import {
  batch,
  effect,
  type ReadonlySignal,
  signal,
} from "@preact/signals-core";
import { DERIVED_CELL_BRAND } from "./reactorBrand";
import { type CellStore, inMemoryStore } from "./server";

// ── Graph node ───────────────────────────────────────────────────────────

/** A node in the backend signal graph: a current LEVEL (the engine signal every
 *  derivation reads) plus the disposer that tears down whatever it installed. A
 *  stateful node (a `scan`) additionally carries a `stopped` latch. */
export interface GraphNode<T> {
  /** The node's current value — a `ReadonlySignal`, so reads are dependencies
   *  and writes are impossible from the outside. */
  readonly value: ReadonlySignal<T>;
  /** Tear down this node and everything it installed (source taps, effects). */
  readonly dispose: () => void;
}

/** A `scan` node — a `GraphNode` that can permanently STOP (a step threw). */
export interface ScanNode<T> extends GraphNode<T> {
  /** Latches `true` the first time a step throws, and never heals — a stopped
   *  derivation holds its last value until the process restarts. Server-side and
   *  observable: it gates the scan from stepping again and distinguishes a frozen
   *  derivation from a legitimately quiet one. (Surfacing a stopped derivation
   *  into the surface's client-side liveness is a LATER phase — the reactive
   *  bridge's open "unhealthy-after-N-failures" question; phase 0 stops loudly,
   *  logs, and latches, but does not yet flip health.) */
  readonly stopped: ReadonlySignal<boolean>;
}

// ── source — external input into the graph ───────────────────────────────

/** What an install returns: an uninstall fn, or nothing. The `| void` is the
 *  honest union — a tap with cleanup returns its uninstall fn, one without
 *  returns nothing; both must be accepted (and `| undefined` would reject a
 *  void-returning install). Kept on its own short line so the suppression can't
 *  drift off it under a reformat. */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` is a required union member — an install with no cleanup returns nothing.
type SourceCleanup = (() => void) | void;

/** Install a push emitter; return an uninstall fn (or nothing). Called once,
 *  lazily, when the first consumer (a `scan`) subscribes. */
export type SourceInstall<T> = (emit: (frame: T) => void) => SourceCleanup;

/** An external input into the graph. Beyond the level signal every node has, a
 *  source exposes per-OCCURRENCE subscription: each `emit(frame)` is an
 *  occurrence a `scan` steps exactly once — a signal alone would conflate
 *  same-batch emissions, which is exactly why `scan` takes a source, not a
 *  signal. */
export interface Source<T> extends GraphNode<T | undefined> {
  /** Subscribe to per-occurrence emissions. Returns an unsubscribe fn. The
   *  first subscriber triggers `install`; the last unsubscribe uninstalls. */
  readonly subscribe: (onEmit: (frame: T) => void) => () => void;
}

/** External input into the graph (push shape): `install` receives an `emit`
 *  callback and returns an uninstall fn. The tap is installed lazily on the
 *  first subscriber and uninstalled when the last one leaves — a source nobody
 *  reads costs nothing.
 *
 *  `initial` seeds the level signal (its value before the first emission); omit
 *  it and the level is `undefined` until the first frame. Phase 0 consumers read
 *  a source only through `scan` (which carries its own initial), so `initial`
 *  matters only for the later `$`/`computed` level reads.
 *
 *  (The poll shape — `source({ read, install })` with a T+0 seed read — is a
 *  later phase; phase 0 ships the push shape its one consumer needs.) */
export function source<T>(install: SourceInstall<T>, initial?: T): Source<T> {
  const level = signal<T | undefined>(initial);
  const listeners = new Set<(frame: T) => void>();
  let uninstall: (() => void) | undefined;
  let installed = false;

  // The bridge owns the batch: one occurrence is one graph frame, so the level
  // update and every scan step it drives coalesce into a single recompute pass.
  const emit = (frame: T): void => {
    batch(() => {
      level.value = frame;
      // Snapshot listeners so a step that (dis)connects mid-fan-out is safe.
      for (const onEmit of [...listeners]) onEmit(frame);
    });
  };

  const ensureInstalled = (): void => {
    if (installed) return;
    installed = true;
    uninstall = install(emit) ?? undefined;
  };
  const teardown = (): void => {
    if (!installed) return;
    installed = false;
    uninstall?.();
    uninstall = undefined;
  };

  return {
    value: level,
    subscribe(onEmit) {
      listeners.add(onEmit);
      ensureInstalled();
      return () => {
        listeners.delete(onEmit);
        if (listeners.size === 0) teardown();
      };
    },
    dispose() {
      listeners.clear();
      teardown();
    },
  };
}

// ── scan — an accumulation over a source ──────────────────────────────────

/** The fold step: `(state, frame) => nextState`. Returning the PREV reference
 *  (`===`) means "no change" — the level holds and nothing publishes. */
export type ScanStep<S, F> = (state: S, frame: F) => S;

/** Accumulate a source's occurrences into a level. Each emission steps the fold
 *  exactly once; the carried state is the node's value.
 *
 *  **Durability** is deliberately absent in phase 0: a scan seeds from its plain
 *  `initial` and does not survive a restart (drishti's `alerts` wants exactly
 *  this — a fresh process re-derives its level from fresh samples). The durable
 *  variant — seeding from a store — is a later phase.
 *
 *  **The stop-hold error law.** A step that throws STOPS the derivation: the
 *  source subscription is disposed, the last state is HELD (never a fabricated
 *  reset), the throw is logged loudly, and `stopped` latches so the surface's
 *  liveness can tell a frozen derivation from a legitimately quiet one. It never
 *  heals — recovery is a restart. (The stateless-compute error policy —
 *  log-skip-continue — is a later phase's `computed`; a `scan` carries state, so
 *  continuing past a throw would fold onto a corrupt accumulator.) */
export function scan<F, S>(
  src: Source<F>,
  initial: S,
  step: ScanStep<S, F>,
): ScanNode<S> {
  const state = signal<S>(initial);
  const stopped = signal(false);
  let unsubscribe: (() => void) | undefined;

  const stop = (): void => {
    unsubscribe?.();
    unsubscribe = undefined;
  };

  unsubscribe = src.subscribe((frame) => {
    if (stopped.peek()) return;
    let next: S;
    try {
      next = step(state.peek(), frame);
    } catch (err) {
      console.error(
        "reactor: scan step threw — stopping derivation, holding last value",
        err,
      );
      stop();
      stopped.value = true;
      return;
    }
    // "step returning the prev reference ⇒ no publish": a held level writes
    // nothing to the signal, so no downstream recompute and no wire frame. The
    // member's own `equals` remains the final wire dedup point for values that
    // differ by reference but not by content.
    if (next !== state.peek()) state.value = next;
  });

  return {
    value: state,
    stopped,
    dispose: () => stop(),
  };
}

// ── derived.cell — publish a graph node as a cell ─────────────────────────

/** The deps a `derived.cell(...)` contributes to `implementSurface`'s
 *  `cells.<key>` slot: an in-memory `store` plus the `connect` hook the runtime
 *  fires once after wiring. It rides the EXISTING cell connect seam with zero
 *  runtime surgery — the same `{ store, connect }` shape `deriveCell` already
 *  uses — plus the derived brand the boot walk reads to enforce wire-read-only. */
export interface DerivedCell<T> {
  readonly store: CellStore<T>;
  readonly connect: (cell: { set: (next: T) => void }) => void;
  /** Tear down the connect effect and the backing node. */
  readonly dispose: () => void;
  readonly [DERIVED_CELL_BRAND]: true;
}

/** The reactor's wire exits. Phase 0 ships `cell`; `collection` is a later
 *  phase. Namespaced (`derived.cell`) so the read-only-projection intent is
 *  legible at every declaration site. */
export const derived = {
  /** Publish a graph node as a cell. The cell is wire-read-only by construction
   *  (the boot walk crashes if it declares a write verb) and seeds from the
   *  node's current level by an eager pull at wiring — truth, never a fabricated
   *  default (a throw at seed time is a boot crash). Every subsequent level
   *  change flows through the member's own `equals → onWrite → store.set →
   *  bus.publish` gate via the `connect` setter, so the wire dedup point is
   *  unchanged and a spec-`equals`-equal recompute never crosses the wire. */
  cell<T>(node: GraphNode<T>): DerivedCell<T> {
    // Eager seed — a pull of the node's current level. This is the derived
    // cell's legitimate default (its serving endpoint IS the authority), the
    // exact opposite of a mirror fabricating a default it never received. Reuse
    // the canonical `inMemoryStore` primitive rather than re-hand-rolling the
    // get/set-over-closure it already is.
    const store = inMemoryStore(node.value.peek());

    let disposeEffect: (() => void) | undefined;

    return {
      store,
      [DERIVED_CELL_BRAND]: true,
      connect: (cell) => {
        // The connect seam: an engine effect subscribes the node's level and
        // pushes every change through the ctx setter (the member's write gate).
        // The first synchronous run pushes the seed, which the member's `equals`
        // dedups against the identical store seed — so wiring a derived cell
        // publishes nothing until the level genuinely moves.
        disposeEffect = effect(() => {
          cell.set(node.value.value);
        });
      },
      dispose: () => {
        disposeEffect?.();
        node.dispose();
      },
    };
  },
};
