/**
 * `reactor.ts` — the reactive bridge.
 *
 * State is a signal; derived state is a computed; **the wire is a signal
 * boundary that snapshots and replays.** This module is the ONE exit from the
 * backend signal graph into `@kolu/surface`'s cell machinery. A signals engine
 * (`@preact/signals-core` today; `@solidjs/signals` the named swap target) is a
 * dependency of `@kolu/surface` ONLY, wrapped HERE and nowhere else — the
 * engine's deep import is lint-banned outside this file (`biome.jsonc`), so this
 * wrapper is the graph's only exit by construction, not by review.
 *
 * Exports: `source` (push + poll `{ read, install }` shapes) + `scan` (phase 0);
 * SR7's typed `$` sibling-read face, `computed`, `batch`, and both `derived.cell`
 * forms (a graph-node `derived.cell(node)` and a compute-fn `derived.cell(($) =>
 * …)`); and — SR8 — `derived.collection(node)` (the keyed-reconciler wire adapter)
 * and the poll source shape. Still ahead: SR9/SR10's keyed machinery
 * (`reactiveFamily`, `derived.registry`, `signalMap`). The full model, laws, and
 * worked examples live in the reactive-bridge note
 * (`docs/atlas/.../surface-reactive-bridge.mdx`).
 *
 * Three guarantees ride every `derived.cell`:
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
  DERIVED_COLLECTION_BRAND,
  type DerivedCollectionBranded,
  DERIVED_COMPUTE_BRAND,
  DERIVED_POLL_BRAND,
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

/** Property key branding a POLL source (`source({ read, install })`). Its graph
 *  node has no synchronous seed — the T+0 read is async — so `derived.cell`
 *  recognises it and wires an ASYNC connect (below). `Symbol.for` for the same
 *  duplicate-module survival reason as the reactor brands. */
const POLL_SOURCE_BRAND: unique symbol = Symbol.for(
  "kolu.surface.reactor.pollSourceNode",
);

/** A POLL source — external input read on a caller-owned cadence rather than a
 *  push emitter. It is a graph node (a level + `dispose`) whose value is filled
 *  asynchronously by `connectPoll`, which `derived.cell` drives. Typed
 *  `GraphNode<T>` (not `T | undefined`) because every SERVED value is a `T`: the
 *  store seeds from the spec default and each read publishes a `T`. The level is
 *  `undefined` only in the pre-first-read window, which no typed consumer reads. */
export interface PollSource<T> extends GraphNode<T> {
  readonly [POLL_SOURCE_BRAND]: true;
  /** Do the T+0 seed read — its **first failure PROPAGATES** (the rejected
   *  promise faults the runtime's `done`, never a fabricated default) — publish it
   *  via `set`, then install the caller's tick cadence. Each later tick re-reads
   *  under a non-overlap (`inFlight`) guard and, on a read throw, LOG-SKIP-CONTINUEs
   *  (holds the last published value), never tearing down a long-lived poll.
   *  Returns the loop's disposer. Called once by `derived.cell`'s connect seam. */
  connectPoll(set: (next: T) => void): Promise<Disposer>;
}

/** The poll argument shape of `source(...)`: an async `read` plus an `install`
 *  that owns the cadence (a `setInterval`, an `onState` force-resample, …). */
export interface PollSourceOptions<T> {
  /** The async poll read. The T+0 call is the seed (first failure propagates); a
   *  later call that throws is logged and skipped (the loop holds its last value). */
  read: () => Promise<T>;
  /** Install the tick cadence: called once after the seed lands, handed a `tick`
   *  that triggers a guarded re-read. Return an uninstall fn (or nothing). */
  install: (tick: () => void) => SourceCleanup;
}

/** Whether a graph node is a POLL source (so `derived.cell` wires its async
 *  connect instead of the synchronous publish effect). */
function isPollSource<T>(node: GraphNode<T>): node is PollSource<T> {
  return (
    (node as unknown as Record<PropertyKey, unknown>)[POLL_SOURCE_BRAND] ===
    true
  );
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
export function source<T>(install: SourceInstall<T>, initial?: T): Source<T>;
export function source<T>(opts: PollSourceOptions<T>): PollSource<T>;
export function source<T>(
  arg: SourceInstall<T> | PollSourceOptions<T>,
  initial?: T,
): Source<T> | PollSource<T> {
  // The poll shape (`{ read, install }`) is its own node — an async seed with no
  // synchronous level, driven by `derived.cell`'s connect. The push shape (a bare
  // install fn) is the original source below.
  if (typeof arg !== "function") return pollSource(arg);
  const install = arg;
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

/** The cadence half of a poll `source` — a fixed-interval `install` that never
 *  holds the process open. `everyMs(ms)` returns the `install` closure a poll
 *  source reads: `source({ read, install: everyMs(5_000) })`. The interval is
 *  `unref`'d so a live sampler is not a reason to keep the event loop alive, and
 *  the returned cleanup clears it. This is the one home for the unref'd-interval
 *  hygiene every interval-driven poll source would otherwise re-spell. */
export function everyMs(ms: number): (tick: () => void) => SourceCleanup {
  return (tick) => {
    const iv = setInterval(tick, ms);
    iv.unref();
    return () => clearInterval(iv);
  };
}

/** The POLL source (`source({ read, install })`). Owns the T+0-seed /
 *  non-overlap / log-skip-continue policy the note assigns to "the bridge"; a
 *  `derived.cell` drives it via {@link PollSource.connectPoll}. Unlike the push
 *  source it has no per-occurrence `subscribe` (a poll level has no per-emission
 *  meaning — it is sampled), so it is not a `scan` input; it is published
 *  directly as a cell (or a collection). */
function pollSource<T>({ read, install }: PollSourceOptions<T>): PollSource<T> {
  const level = signal<T | undefined>(undefined);
  let inFlight = false;
  let uninstall: (() => void) | undefined;
  let disposed = false;

  // One guarded, publishing read for a LATER tick: skip if a read is in flight or
  // the node is torn down; on success publish to the level (for `$` readers) and
  // through `set` (the wire); on a throw LOG-SKIP-CONTINUE — hold the last
  // published value, never tear down a long-lived poll.
  const tickRead = (set: (next: T) => void): void => {
    if (inFlight || disposed) return;
    inFlight = true;
    read()
      .then(
        (v) => {
          if (disposed) return;
          level.value = v;
          set(v);
        },
        (err) =>
          console.error(
            "reactor: poll source read threw — holding last published value",
            err,
          ),
      )
      .finally(() => {
        inFlight = false;
      });
  };

  const teardownLoop = (): void => {
    const u = uninstall;
    uninstall = undefined;
    u?.();
  };

  return {
    // The level is `T | undefined` internally (undefined until the first read),
    // but a poll source presents as `GraphNode<T>` — see the interface doc. The
    // cast is the one spot that boundary lives.
    value: level as unknown as ReadonlySignal<T>,
    [POLL_SOURCE_BRAND]: true,
    connectPoll: async (set) => {
      // T+0 SEED read — its failure PROPAGATES (mirror-never-fabricate: no default
      // stands in for an unread poll). `inFlight` fences a tick that would race the
      // seed, though `install` runs only after the seed lands.
      inFlight = true;
      let seed: T;
      try {
        seed = await read();
      } finally {
        inFlight = false;
      }
      // Disposed mid-seed (the runtime closed before the first read landed): do not
      // publish or install — hand back a no-op disposer.
      if (disposed) return () => {};
      level.value = seed;
      set(seed);
      uninstall = install(() => tickRead(set)) ?? undefined;
      return teardownLoop;
    },
    dispose: () => {
      disposed = true;
      teardownLoop();
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
 *  heals — recovery is a restart. (Contrast the stateless-compute error policy —
 *  log-skip-continue — a `derived.cell` / `computed` holds its last value and
 *  heals on the next good recompute; a `scan` carries state, so continuing past a
 *  throw would fold onto a corrupt accumulator, which is why it stops instead.) */
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
   *  derived cell joins the runtime's ownership). A POLL-source cell connects
   *  ASYNCHRONOUSLY — it returns a `Promise<Disposer>` that resolves once the T+0
   *  seed read lands (a rejection propagates to the runtime's `done`); the
   *  runtime's async connector seam awaits either shape. */
  readonly connect: (cell: {
    set: (next: T) => void;
  }) => Disposer | Promise<Disposer>;
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

/** A derived cell's public store facade, shared by both `derived.cell` forms:
 *  `get` reads the graph node's current level (an eager truth, never a fabricated
 *  default), and `set` THROWS — the graph is the member's ONE writer, so a direct
 *  write is a fail-fast defect, not a live path. The dep carries no writable
 *  backing; `implementSurface` builds and owns the private serving store. */
function graphOwnedStore<T>(get: () => T): CellStore<T> {
  return {
    get,
    set: () => {
      throw new Error(
        "derived cell store is graph-owned (one writer) — the graph is its only writer; do not set it directly",
      );
    },
  };
}

/** The connect seam's publish effect, shared by both `derived.cell` forms: an
 *  engine effect that pushes each recompute of `read` through the member's write
 *  gate (`set`). It carries the stateless-compute error policy in ONE home — a
 *  throw is LOGGED and the last published value HELD (the effect returns without
 *  setting), healing on the next good recompute, so no bridge effect body escapes
 *  synchronously into the writer's stack. `label` names the member kind in the
 *  log. (A SEED throw stays a boot crash — it happens at the eager `store.get()`
 *  pull, before this effect is wired.) */
function connectPublishEffect<T>(
  read: () => T,
  set: (next: T) => void,
  label: string,
): () => void {
  return effect(() => {
    let next: T;
    try {
      next = read();
    } catch (err) {
      console.error(
        `reactor: ${label} recompute threw — holding last published value`,
        err,
      );
      return;
    }
    set(next);
  });
}

/** The async poll-connect protocol, shared by every builder that wires a POLL
 *  source (`derived.cell` and `derived.collection`). `connectPoll` does the T+0
 *  seed read (a rejection propagates through this promise to the runtime's
 *  `done`), publishes it via `onValue`, and installs the tick loop — resolving to
 *  the loop's disposer. If the builder was torn down while the seed was in flight
 *  (`isTorn()`), dispose the just-installed loop rather than joining it to a
 *  torn-down node; otherwise `adopt` the disposer and return the builder's
 *  `teardown` so the runtime's `close()` disposes the subscription. */
function connectPollNode<T>(
  poll: PollSource<T>,
  onValue: (v: T) => void,
  isTorn: () => boolean,
  adopt: (d: Disposer) => void,
  teardown: Disposer,
): Promise<Disposer> {
  return poll.connectPoll(onValue).then((loopDispose) => {
    if (isTorn()) {
      loopDispose();
      return () => {};
    }
    adopt(loopDispose);
    return teardown;
  });
}

/** The graph-node `derived.cell(node)` — publish a pre-built graph node (a
 *  `scan`, a `computed`) as a cell. Extracted so `derived.cell` can OVERLOAD the
 *  compute-fn form beside it. */
function graphNodeCell<T>(node: GraphNode<T>): DerivedCell<T> {
  // A POLL source (`source({ read, install })`) owns its own async seed + tick
  // loop, so it connects asynchronously (below) and the boot walk seeds its store
  // from the spec default (it has no synchronous level until the first read).
  const poll = isPollSource(node) ? node : undefined;
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
    // Public store is the READ-ONLY, STATELESS facade (`get` pulls the node's
    // current level live — an eager truth, never a fabricated default — and `set`
    // throws). The dep carries NO writable store; `implementSurface` builds and
    // owns its own private serving store (seeded from this `get`) and writes it
    // only through the `connect` seam, so nothing a holder can reflect off this
    // dep can poison the wire snapshot `cellHandlers.get` serves.
    store: graphOwnedStore(() => node.value.peek()),
    // Engine-tracked sibling read: `.value` (not `.peek()`) so a downstream
    // computed reading `$.thisCell()` tracks this node directly — the shared
    // computed graph the glitch-freedom law rests on.
    siblingRead: () => node.value.value,
    [DERIVED_CELL_BRAND]: true,
    // A poll source has no synchronous seed (its T+0 read is async), so the boot
    // walk seeds this cell's store from the SPEC DEFAULT — the async connect below
    // publishes the first read. The brand tells the walk which seed to use.
    ...(poll ? { [DERIVED_POLL_BRAND]: true } : {}),
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
      if (poll) {
        // A poll source connects ASYNCHRONOUSLY (see `connectPollNode`): the T+0
        // seed read faults the runtime's `done` on rejection — a boot crash,
        // never a fabricated default.
        return connectPollNode(
          poll,
          (next) => cell.set(next),
          () => torn,
          (d) => {
            disposeEffect = d;
          },
          teardown,
        );
      }
      // The connect seam: an engine effect subscribes the node's level and
      // pushes every change through the ctx setter (the member's write gate).
      // The first synchronous run pushes the seed, which the member's `equals`
      // dedups against the identical store seed — so wiring a derived cell
      // publishes nothing until the level genuinely moves.
      //
      // Stateless-compute error policy (no bridge effect body escapes its
      // wrapper): a LATER read that throws — a `computed(fn)` node whose `fn`
      // hits a case it can't handle — is logged and the last published value
      // HELD, healing on the next good recompute. (The SEED throw is a boot crash,
      // caught at the eager `store.get()` pull, not here.) Without this a
      // `derived.cell(computed(fn))` throw would escape synchronously into the
      // writer's stack.
      disposeEffect = connectPublishEffect(
        () => node.value.value,
        (next) => cell.set(next),
        "derived cell",
      );
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
    // Eager seed pull (`requireNode().peek()`): reads the compute's CURRENT value
    // (truth from the siblings), never a fabricated default; a throw is a boot
    // crash (mirror-never-fabricate). Valid only after `bindSiblings`.
    store: graphOwnedStore(() => requireNode().peek()),
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
      disposeEffect = connectPublishEffect(
        () => n.value,
        (next) => cell.set(next),
        "derived compute cell",
      );
      return teardown;
    },
    dispose: teardown,
  };
}

/** `derived.collection(node)` — publish a keyed graph node (a poll `source`
 *  reading a whole `Map`, or a `computed`/`$`-compute producing one) as a
 *  COLLECTION. The RECONCILER is the wire adapter: it subscribes the node and diffs
 *  each new map against the last by the collection's `equals`, driving the surface's
 *  own per-key `upsert`/`remove` publishers for exactly the changed and removed
 *  keys. The graph is the one writer — the boot walk narrows the ctx
 *  `upsert`/`remove` to throw and fires this `connect`. */
function derivedCollection<K, V>(
  node: GraphNode<ReadonlyMap<K, V>>,
): DerivedCollectionBranded {
  const poll = isPollSource(node) ? node : undefined;
  // The materialized current map — the wire snapshot a late subscriber reads, and
  // the reconciler's "last" baseline. Empty until the first frame lands; mutated
  // in place per key by the reconcile (never reassigned), so the `readAll` snapshot
  // always reflects what has been published.
  const current = new Map<K, V>();
  let disposeReconcile: (() => void) | undefined;
  let connected = false;
  let torn = false;

  const teardown = (): void => {
    if (torn) return;
    torn = true;
    try {
      disposeReconcile?.();
    } finally {
      node.dispose();
    }
  };

  // Diff `next` against `current` by `equals`, drive the per-key publishers for the
  // changed + removed keys, then adopt `next` as the new baseline. The default
  // `equals` (`() => false`, injected by the walk when the spec declares none)
  // makes every present key "changed" — the unconditional re-publish for a per-tick
  // rate that always moves (drishti's `cpuCores`/`networkInterfaces`).
  const reconcile = (
    next: ReadonlyMap<K, V>,
    pub: {
      upsert(k: K, v: V): void;
      remove(k: K): void;
      equals(a: V, b: V): boolean;
    },
  ): void => {
    // Update `current` BEFORE each publisher call, so the surface's own `readAll()`
    // (which its `keys` broadcast reads) already reflects the key by the time the
    // wrapped publisher fires. Snapshot the removal keys (spread) so deleting mid-
    // iteration is safe.
    for (const [k, v] of next) {
      if (!current.has(k) || !pub.equals(current.get(k) as V, v)) {
        current.set(k, v);
        pub.upsert(k, v);
      }
    }
    for (const k of [...current.keys()]) {
      if (!next.has(k)) {
        current.delete(k);
        pub.remove(k);
      }
    }
  };

  return {
    [DERIVED_COLLECTION_BRAND]: true,
    readAll: () => new Map(current) as Map<unknown, unknown>,
    readOne: (key) => current.get(key as K),
    connect: (publishers) => {
      if (torn) {
        throw new Error(
          "derived collection: connect() after dispose() — already torn down (one-shot lifecycle)",
        );
      }
      if (connected) {
        throw new Error(
          "derived collection: connect() called twice — wires exactly one subscription",
        );
      }
      connected = true;
      const pub = {
        upsert: (k: K, v: V) => publishers.upsert(k, v),
        remove: (k: K) => publishers.remove(k),
        equals: publishers.equals as (a: V, b: V) => boolean,
      };
      if (poll) {
        // Async (see `connectPollNode`): the seed read gives the first whole map
        // (reconciled against the empty baseline ⇒ every key upserted), then each
        // tick's map reconciles. A first-read rejection faults the runtime's `done`.
        return connectPollNode(
          poll,
          (nextMap) => reconcile(nextMap, pub),
          () => torn,
          (d) => {
            disposeReconcile = d;
          },
          teardown,
        );
      }
      // A non-poll node (a `computed`/`$`-compute producing a map): an engine effect
      // reconciles on each change. Log-skip-continue on a compute throw (hold last).
      disposeReconcile = effect(() => {
        let nextMap: ReadonlyMap<K, V>;
        try {
          nextMap = node.value.value;
        } catch (err) {
          console.error(
            "derived collection: recompute threw — holding last published keys",
            err,
          );
          return;
        }
        reconcile(nextMap, pub);
      });
      return teardown;
    },
    dispose: teardown,
  };
}

/** The reactor's wire exits. Phase 0 shipped the graph-node `cell`; SR7 adds the
 *  compute-fn overload (`derived.cell(($) => …)`); SR8 adds `collection`.
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
  /** Publish a keyed graph node — a poll `source({ read, install })` reading a
   *  whole `Map`, or a `computed` producing one — as a COLLECTION. The reconciler
   *  diffs each frame against the last by the collection's `equals` and publishes
   *  only the changed + removed keys (the keyed-reconciler wire adapter). Wire-read-
   *  only: the graph is the collection's one writer. */
  collection<K, V>(
    node: GraphNode<ReadonlyMap<K, V>>,
  ): DerivedCollectionBranded;
}

export const derived: DerivedApi = {
  cell(
    arg: GraphNode<unknown> | ((siblings: SiblingRead<SurfaceSpec>) => unknown),
    // biome-ignore lint/suspicious/noExplicitAny: the two overloads' return types are the public contract; the impl is intentionally loose
  ): any {
    return typeof arg === "function" ? computeCell(arg) : graphNodeCell(arg);
  },
  collection<K, V>(
    node: GraphNode<ReadonlyMap<K, V>>,
  ): DerivedCollectionBranded {
    return derivedCollection(node);
  },
};
