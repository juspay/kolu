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
  computed as engineComputed,
  effect,
  type ReadonlySignal,
  signal,
} from "@preact/signals-core";
import type { SiblingRead, SurfaceSpec } from "./define";
import {
  DERIVED_CELL_BRAND,
  DERIVED_COMPUTE_BRAND,
  type SiblingSourcesRuntime,
} from "./reactorBrand";
import type { CellStore, Disposer } from "./server";

/** `batch` — group several graph writes into ONE frame, so derivations
 *  recompute once. The bridge owns the batch at every internal graph entry point
 *  (a source `emit`, a poll tick); this re-export is the ONE knob an app reaches
 *  for to coalesce a multi-member burst of ctx writes into a single recompute
 *  pass (e.g. `batch(() => { registry.set(a); registry.delete(b); })`). It is the
 *  engine's `batch`, surfaced through the reactor so app code never deep-imports
 *  the engine. */
export { batch };

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
  // Generation fence: each install gets an `emit` bound to the generation it was
  // installed under, and teardown bumps the generation. A late callback from a
  // torn-down tap (generation A) that fires after an uninstall/reinstall is then
  // silently DROPPED — never delivered as a current occurrence to generation B's
  // listeners. The tap contract still says "stop emitting on uninstall"; the
  // fence is the belt-and-braces that makes a racy source's stale frame a no-op
  // rather than a phantom occurrence a `scan` folds in.
  let generation = 0;

  // The bridge owns the batch: one occurrence is one graph frame, so the level
  // update and every scan step it drives coalesce into a single recompute pass.
  const makeEmit =
    (gen: number) =>
    (frame: T): void => {
      if (gen !== generation) return; // stale tap from a torn-down install — fenced
      batch(() => {
        level.value = frame;
        // Snapshot listeners so a step that (dis)connects mid-fan-out is safe.
        for (const onEmit of [...listeners]) onEmit(frame);
      });
    };

  const ensureInstalled = (): void => {
    if (installed) return;
    // Transactional: mark installed only AFTER a successful `install`. A throwing
    // install must leave the source uninstalled (installed = false, no leaked
    // uninstall) so a later subscriber can retry — not wedged installed-forever
    // with no way to emit. The just-added listener is removed by `subscribe`.
    const gen = generation;
    let cleanup: (() => void) | undefined;
    try {
      cleanup = install(makeEmit(gen)) ?? undefined;
    } catch (err) {
      // A failed install may have retained its `emit` (bound to `gen`) before it
      // threw. Advance the generation NOW so that emitter is fenced immediately —
      // otherwise a successful retry reuses the same `gen` (no teardown ran on a
      // failed attempt) and the failed attempt's late callback would pass the fence
      // and reach the retry's listeners as a phantom occurrence.
      generation++;
      throw err;
    }
    installed = true;
    uninstall = cleanup;
  };
  const teardown = (): void => {
    if (!installed) return;
    installed = false;
    generation++; // invalidate the just-uninstalled tap's `emit`
    // Clear the handle BEFORE invoking it, and CONTAIN a throw. `teardown` runs
    // from inside `scan`'s stop-hold catch, itself inside the batched `emit`
    // fan-out, so an uninstall that throws would starve sibling listeners of the
    // current frame and propagate out of `emit()`. Log loudly, stay contained —
    // the belt-and-braces twin of `install()`'s try/catch above.
    const cleanup = uninstall;
    uninstall = undefined;
    try {
      cleanup?.();
    } catch (err) {
      console.error("reactor: source uninstall threw during teardown", err);
    }
  };

  return {
    value: level,
    subscribe(onEmit) {
      listeners.add(onEmit);
      try {
        ensureInstalled();
      } catch (err) {
        // Install failed: undo the membership so we neither leak the listener nor
        // report a subscription the caller can't unsubscribe (we rethrow).
        listeners.delete(onEmit);
        throw err;
      }
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
  // A stop requested DURING `src.subscribe` (a source that emits synchronously on
  // install, whose first frame throws) has no `unsubscribe` handle yet — it is
  // assigned only after `subscribe` returns. Latch the request here so the
  // post-subscribe wiring disposes the handle the instant it exists, instead of
  // leaving the stopped scan subscribed (guarded but leaking its source tap).
  let stopRequested = false;

  const stop = (): void => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = undefined;
    } else {
      stopRequested = true; // handle not yet assigned (sync emit during subscribe)
    }
  };

  const handle = src.subscribe((frame) => {
    if (stopped.peek()) return;
    let next: S;
    try {
      next = step(state.peek(), frame);
    } catch (err) {
      console.error(
        "reactor: scan step threw — stopping derivation, holding last value",
        err,
      );
      // Latch `stopped` BEFORE tearing down: the stop-hold law's observable fact
      // must hold even if `stop()`/cleanup throws — a failed unsubscribe can
      // never un-stop or replace the latched state.
      stopped.value = true;
      stop();
      return;
    }
    // "step returning the prev reference ⇒ no publish": a held level writes
    // nothing to the signal, so no downstream recompute and no wire frame. The
    // member's own `equals` remains the final wire dedup point for values that
    // differ by reference but not by content.
    if (next !== state.peek()) state.value = next;
  });
  // If a synchronous install-emit already stopped us, dispose the handle now
  // (never retain it); otherwise keep it as the live unsubscribe.
  if (stopRequested) handle();
  else unsubscribe = handle;

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
  /** READ-ONLY by construction and stateless: `get` reads the node's CURRENT level
   *  live (`node.value.peek()`); `set` THROWS (the graph is the one writer). Typed
   *  `CellStore<T>` so a derived cell still satisfies `CellImplDeps`, but the dep
   *  carries NO writable backing store at all — nothing reflectively reachable
   *  (`Object.getOwnPropertySymbols`) can poison the wire snapshot. `implementSurface`
   *  builds its OWN private serving store (seeded from this `get`) and drives it
   *  exclusively through the `connect` seam. */
  readonly store: CellStore<T>;
  /** The `connect` seam. Subscribes the node's level and returns a
   *  {@link Disposer} that tears down the effect + backing node — so the
   *  {@link SurfaceRuntime}'s `close()` disposes the reactor subscription (the
   *  derived cell joins the runtime's ownership). */
  readonly connect: (cell: { set: (next: T) => void }) => Disposer;
  /** Tear down the connect effect and the backing node. Idempotent — the same
   *  teardown `connect` returns, so a standalone owner and the runtime's
   *  `close()` never double-dispose. */
  readonly dispose: () => void;
  /** An ENGINE-TRACKED read of this cell's graph node (its `computed`/`scan`
   *  signal, LIVE). The boot walk registers it as this derived member's `$`
   *  sibling source, so a sibling reading it inside its own computed depends on
   *  this node directly — the derived-reads-derived chain is a pure computed
   *  graph, glitch-free by lazy pull (never the push-lagging mirror). */
  siblingRead(): T;
  readonly [DERIVED_CELL_BRAND]: true;
}

/** The COMPUTE-FN form of a derived cell — `derived.cell(($) => …)`. It reads
 *  its SIBLINGS through the typed `$` face rather than wrapping a pre-built graph
 *  node, so the boot walk cannot build its node until every sibling mirror
 *  exists: it carries {@link DERIVED_COMPUTE_BRAND} and a `bindSiblings` seam the
 *  walk calls once, after `$` assembly, before seeding. `S` rides a phantom so
 *  the deps slot flows the surface's sibling types back to the `($)` parameter
 *  (typed at the call site, never read at runtime). */
export interface DerivedComputeCell<S extends SurfaceSpec, T>
  extends DerivedCell<T> {
  readonly [DERIVED_COMPUTE_BRAND]: true;
  /** Build the compute node from the assembled sibling sources. Called ONCE by
   *  the boot walk after every sibling mirror exists; `store.get()` (the eager
   *  seed pull) and `connect` are only valid after it. */
  bindSiblings(sources: SiblingSourcesRuntime): void;
  /** Phantom carrying `S` so the deps slot can flow `$`'s type to the compute
   *  fn's parameter. Never present at runtime. */
  readonly __computeSurface?: (siblings: SiblingRead<S>) => void;
}

/** A derived value — a pure graph node reading OTHER graph nodes (a private
 *  intermediate several wire members can share without any of them becoming a
 *  wire member). Glitch-free by the engine's version-checked lazy pull. A pure
 *  computed installs nothing, so its `dispose` is a no-op — it composes into
 *  `derived.cell(node)` exactly like a `scan`. */
export function computed<T>(compute: () => T): GraphNode<T> {
  return { value: engineComputed(compute), dispose: () => {} };
}

/** The graph-node `derived.cell(node)` — publish a pre-built graph node (a
 *  `scan`, a `computed`) as a cell. Extracted so `derived.cell` can OVERLOAD the
 *  compute-fn form beside it. */
function graphNodeCell<T>(node: GraphNode<T>): DerivedCell<T> {
  let disposeEffect: (() => void) | undefined;
  let connected = false;
  // ONE idempotent teardown, shared by `connect`'s returned disposer (the
  // runtime's `close()`) and the standalone `dispose()` — so neither can
  // double-dispose the effect + node.
  let torn = false;
  const teardown = (): void => {
    if (torn) return;
    torn = true;
    // Attempt BOTH the effect disposal and the node disposal even if the first
    // throws — a failing effect teardown must not strand the backing node.
    try {
      disposeEffect?.();
    } finally {
      node.dispose();
    }
  };

  return {
    // Public store is a READ-ONLY, STATELESS facade: `get` pulls the node's
    // current level live (its serving endpoint IS the authority — an eager
    // truth, never a fabricated default); `set` throws (fail-fast one-writer
    // guard). The dep carries NO writable store — `implementSurface` builds and
    // owns its own private serving store (seeded from this `get`) and writes it
    // only through the `connect` seam, so nothing a holder can reflect off this
    // dep can poison the wire snapshot `cellHandlers.get` serves.
    store: {
      get: () => node.value.peek(),
      set: () => {
        throw new Error(
          "derived cell store is graph-owned (one writer) — the graph is its only writer; do not set it directly",
        );
      },
    },
    // Engine-tracked sibling read: `.value` (not `.peek()`) so a downstream
    // computed reading `$.thisCell()` tracks this node directly — the shared
    // computed graph the glitch-freedom law rests on.
    siblingRead: () => node.value.value,
    [DERIVED_CELL_BRAND]: true,
    connect: (cell) => {
      // One-shot lifecycle, fail-fast on misuse: a derived cell wires exactly
      // ONE subscription, and only while it is live. Connecting after teardown
      // (a standalone `dispose()` ran first) would install an effect whose
      // returned teardown is a permanent no-op (`torn` is already set) — a
      // silent leak; connecting twice would strand the first effect. Crash
      // loudly rather than model either impossible state.
      if (torn) {
        throw new Error(
          "derived cell: connect() after dispose() — the cell is already torn down (one-shot lifecycle)",
        );
      }
      if (connected) {
        throw new Error(
          "derived cell: connect() called twice — a derived cell wires exactly one subscription",
        );
      }
      connected = true;
      // The connect seam: an engine effect subscribes the node's level and
      // pushes every change through the ctx setter (the member's write gate).
      // The first synchronous run pushes the seed, which the member's `equals`
      // dedups against the identical store seed — so wiring a derived cell
      // publishes nothing until the level genuinely moves.
      disposeEffect = effect(() => {
        cell.set(node.value.value);
      });
      // Return the teardown so the runtime's `close()` disposes this
      // subscription (the reactor sub joins the runtime's ownership).
      return teardown;
    },
    dispose: teardown,
  };
}

/** The compute-fn `derived.cell(($) => …)` — a derivation over SIBLINGS. Reading
 *  `$.<sibling>()` inside the compute is depending on that sibling; the reactor
 *  wraps each read in a per-sibling version signal (bumped by the sibling's
 *  post-equals change edge) so the compute recomputes exactly when a sibling it
 *  read moved. The compute node cannot exist until every sibling mirror does, so
 *  `bindSiblings` builds it lazily; `store.get()`/`connect` require it. */
function computeCell<S extends SurfaceSpec, T>(
  compute: (siblings: SiblingRead<S>) => T,
): DerivedComputeCell<S, T> {
  let node: ReadonlySignal<T> | undefined;
  const unsubscribes: Array<() => void> = [];
  let disposeEffect: (() => void) | undefined;
  let connected = false;
  let torn = false;

  const requireNode = (): ReadonlySignal<T> => {
    if (!node) {
      throw new Error(
        "derived compute cell: used before bindSiblings() — the boot walk must assemble $ and bind it before seeding/connecting.",
      );
    }
    return node;
  };

  const teardown = (): void => {
    if (torn) return;
    torn = true;
    // Dispose the connect effect first, then release every sibling subscription
    // even if the effect teardown throws — a failing effect teardown must not
    // strand the sibling taps.
    try {
      disposeEffect?.();
    } finally {
      for (const off of unsubscribes) off();
      unsubscribes.length = 0;
    }
  };

  const bindSiblings = (sources: SiblingSourcesRuntime): void => {
    if (node) {
      throw new Error(
        "derived compute cell: bindSiblings() called twice — the compute node is built once.",
      );
    }
    // Two sibling kinds, distinguished by `source.engineTracked`:
    //   - DERIVED sibling → its graph node's `computed` read LIVE: the engine
    //     tracks it DIRECTLY when read inside this compute, so a derived-reads-
    //     derived chain is one pure computed graph, glitch-free by lazy pull. No
    //     version signal, no subscription — the engine owns the edge.
    //   - AUTHORED sibling (cell/collection) → a mirror: its value read live, its
    //     reactive edge a per-sibling version signal, created LAZILY on first read
    //     (an unread sibling gets no signal and no subscription) and bumped by the
    //     sibling's post-equals change. Both reads happen inside `engineComputed`
    //     below, so the engine tracks them.
    const versions = new Map<string, ReturnType<typeof signal<number>>>();
    const siblings = new Proxy({} as SiblingRead<S>, {
      get(_target, key) {
        const name = key as string;
        return () => {
          const source = sources[name];
          if (!source) {
            throw new Error(
              `derived compute cell: read of unknown sibling "$.${name}" — no such cell or collection on this surface.`,
            );
          }
          if (source.engineTracked) return source.read(); // derived: shared computed
          let version = versions.get(name);
          if (!version) {
            const created = signal(0);
            versions.set(name, created);
            unsubscribes.push(
              source.subscribe(() => {
                created.value++;
              }),
            );
            version = created;
          }
          version.value; // track — depend on this authored sibling
          return source.read();
        };
      },
    });
    node = engineComputed(() => compute(siblings));
  };

  return {
    store: {
      // Eager seed pull: reads the compute's CURRENT value (truth from the
      // siblings), never a fabricated default. A throw here is a boot crash
      // (mirror-never-fabricate). Valid only after `bindSiblings`.
      get: () => requireNode().peek(),
      set: () => {
        throw new Error(
          "derived cell store is graph-owned (one writer) — the graph is its only writer; do not set it directly",
        );
      },
    },
    // Engine-tracked sibling read of this compute cell's computed (`.value`, not
    // `.peek()`), so a downstream `$.thisCell()` tracks it directly — glitch-free.
    siblingRead: () => requireNode().value,
    [DERIVED_CELL_BRAND]: true,
    [DERIVED_COMPUTE_BRAND]: true,
    bindSiblings,
    connect: (cell) => {
      if (torn) {
        throw new Error(
          "derived compute cell: connect() after dispose() — the cell is already torn down (one-shot lifecycle)",
        );
      }
      if (connected) {
        throw new Error(
          "derived compute cell: connect() called twice — a derived cell wires exactly one subscription",
        );
      }
      connected = true;
      const n = requireNode();
      // Stateless-compute error policy — LOG-SKIP-CONTINUE holding the last
      // published value: a throw in the compute (a recompute hitting a case it
      // can't handle) is logged and the last good value HELD, and the next
      // successful recompute heals it. (Contrast `scan`'s stop-hold: a scan
      // carries state, so a throwing step STOPS; a stateless compute has no
      // corrupt accumulator to protect, so it continues.) The first run pushes
      // the seed, which the member's `equals` dedups against the identical store
      // seed — so wiring publishes nothing until the derivation genuinely moves.
      disposeEffect = effect(() => {
        let next: T;
        try {
          next = n.value;
        } catch (err) {
          console.error(
            "reactor: derived compute cell recompute threw — holding last published value",
            err,
          );
          return;
        }
        cell.set(next);
      });
      return teardown;
    },
    dispose: teardown,
  };
}

/** The reactor's wire exits. Phase 0 shipped the graph-node `cell`; SR7 adds the
 *  compute-fn overload (`derived.cell(($) => …)`); `collection` is a later phase.
 *  Namespaced (`derived.cell`) so the read-only-projection intent is legible at
 *  every declaration site. */
interface DerivedApi {
  /** Publish a pre-built graph node (a `scan`, a `computed`) as a cell — seeds
   *  from the node's current level by an eager pull at wiring (a throw is a boot
   *  crash), and every level change flows through the member's own `equals →
   *  onWrite → store.set → bus.publish` gate via the `connect` setter, so the
   *  wire dedup point is unchanged. */
  cell<T>(node: GraphNode<T>): DerivedCell<T>;
  /** Publish a SIBLING derivation as a cell — `derived.cell(($) => f($.a(), …))`.
   *  `$` is the typed sibling-read face; reading a sibling is depending on it, so
   *  the cell recomputes exactly when a sibling it read changed. Wire-read-only
   *  and eager-seeded like the graph-node form; the recompute is glitch-free and
   *  its error policy is log-skip-continue (holds last published on a throw). */
  cell<S extends SurfaceSpec, T>(
    compute: (siblings: SiblingRead<S>) => T,
  ): DerivedComputeCell<S, T>;
}

export const derived: DerivedApi = {
  cell(
    arg: GraphNode<unknown> | ((siblings: SiblingRead<SurfaceSpec>) => unknown),
    // biome-ignore lint/suspicious/noExplicitAny: the two overloads' return types are the public contract; the impl is intentionally loose
  ): any {
    return typeof arg === "function" ? computeCell(arg) : graphNodeCell(arg);
  },
};
