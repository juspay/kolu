/**
 * `reactor.ts` — the reactive bridge.
 *
 * State is a signal; derived state is a computed; **the wire is a signal
 * boundary that snapshots and replays.** This module is the ONE exit from the
 * backend signal graph into `@kolu/surface`'s cell machinery. The signals engine
 * is Effect's own `Atom`/`AtomRegistry` (`effect/unstable/reactivity`) — no
 * separate engine package, so `effect` is the only dependency `@kolu/surface`
 * carries for the graph — wrapped HERE and nowhere else: the engine's deep
 * import is lint-banned outside this file (`biome.jsonc`), so this wrapper is
 * the graph's only exit by construction, not by review.
 *
 * Exports: `source` (push + poll `{ read, install }` shapes) + `scan` (phase 0);
 * SR7's typed `$` sibling-read face, `computed`, `batch`, and both `derived.cell`
 * forms (a graph-node `derived.cell(node)` and a compute-fn `derived.cell(($) =>
 * …)`); and — SR8 — `derived.collection(node)` (the keyed-reconciler wire adapter)
 * and the poll source shape; and — SR9 — the keyed `reactiveFamily` (a keyed
 * family of member states as a graph source: membership diff, last-frame hold,
 * per-key disposal, per-member error isolation) plus `derived.registry` (its
 * pull-face `MapRegistry` exit). Still ahead: SR10's `signalMap`. The full model,
 * laws, and worked examples live in the reactive-bridge note
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

import { Result } from "effect";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { AsyncLocalStorage } from "node:async_hooks";
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

// ── The engine seam ──────────────────────────────────────────────────────
//
// FOUR primitives and only four — `signal` (a mutable graph root), `derive`
// (a lazily-pulled, glitch-free derivation), `effect` (a subscriber with a
// disposer) and `batch` (one frame). That is the whole contract the engine note
// pins, and it is why swapping the engine is a two-way door: everything below
// this seam is plain JS, and the three things engines disagree on — equals
// gating, error policy, flush discipline — are owned HERE, by the wrapper, not
// by the engine.
//
// The engine is Effect's `Atom` + `AtomRegistry`. Two differences from a
// preact-shaped engine are load-bearing and are neutralised here, once, so no
// call site can get them wrong:
//
//   1. **Atom does not batch implicitly.** A preact setter opens an implicit
//      batch; `AtomRegistry.set` does not, and an unbatched write to a diamond
//      whose apex has a subscriber recomputes that apex ONCE PER LEG — a
//      transient half-updated read plus a duplicate notify. So every write goes
//      through {@link signal}'s setter, which wraps itself in `Atom.batch`.
//      `batch` is depth-counted, so nesting inside the public `batch()` (or
//      inside a source `emit`) costs nothing.
//   2. **Atom rebuilds a stale node on the WRITER's stack** when it has active
//      subscribers, so a throwing derivation would escape into `ctx.cells.x.set`
//      instead of the subscriber that owns the log-skip-continue policy. So a
//      derivation's node value is a {@link Result} — the read never throws — and
//      the throw is re-raised at the READ faces (`.value`/`.peek()`), which is
//      exactly where the bridge's error policy already lives.
//
// Nodes that CARRY STATE are `Atom.keepAlive`: an idle Atom node is removed and
// its value silently resets to the atom's initial, which for a `scan` level or a
// version counter is state loss. Pure derivations stay auto-disposing — they are
// recomputed on demand, which is what "pure" means. The cost of `keepAlive` is
// that the registry retains one small node per stateful graph node ever built,
// past `dispose()`; that is bounded by BOOT-TIME construction (every `source` /
// `scan` / `reactiveFamily` / compute cell in the tree is built once, when a
// surface is implemented), never per connection, so it is a fixed cost rather
// than a leak.

/** The bridge's ONE graph. A module-level registry is the honest analogue of a
 *  signal engine's implicit global graph, and it is what lets `source`/`scan`/
 *  `computed` stay FREE FUNCTIONS: threading an `AtomRegistry` (or a `Layer`)
 *  through them would force every consumer into an Effect context for what is a
 *  synchronous, non-Effect bridge — the reactor's entire job. */
const GRAPH = AtomRegistry.make();

/** The ambient dependency-tracking context, live only for the duration of one
 *  derivation's recompute.
 *
 *  Atom passes the tracking context in as an argument (`read: (get) => A`) where
 *  a preact-shaped engine keeps it ambient. The bridge needs it ambient: a `$`
 *  sibling read reaches the reader's node through an OPAQUE closure held by
 *  `server.ts`'s boot walk (`SiblingSource.read`, deliberately engine-free so
 *  `server.ts` never imports this module), and there is no argument to thread
 *  through it. Saved/restored around every recompute, so nesting is exact. */
let currentGet: Atom.AtomContext | undefined;

/** What the running derivation has DEPENDED on so far — the set {@link signal}'s
 *  setter consults to repair the DUAL-EDGE pattern (below). Lives beside
 *  {@link currentGet} and is saved/restored with it. */
let currentDeps: Set<unknown> | undefined;

/** Run `f` with `get` as the ambient tracking context. */
function withTracking<T>(get: Atom.AtomContext, f: () => T): T {
  const priorGet = currentGet;
  const priorDeps = currentDeps;
  currentGet = get;
  currentDeps = new Set();
  try {
    return f();
  } finally {
    currentGet = priorGet;
    currentDeps = priorDeps;
  }
}

/** A read that DEPENDS: inside a derivation it registers the edge; outside one it
 *  is just a read (there is nothing to depend). */
function trackedRead<T>(atom: Atom.Atom<T>): T {
  if (currentGet === undefined) return GRAPH.get(atom);
  currentDeps?.add(atom);
  return currentGet(atom);
}

/** A derivation's node value: its result, or the throw it produced. Held as a
 *  value so the node's read is TOTAL — see the seam note above. */
type Outcome<T> = Result.Result<T, unknown>;

/** Equality for a derivation's node: compare the PAYLOADS, so the
 *  equality-cascade stop still works through the wrapper (a fresh `Result`
 *  object per recompute would otherwise defeat it and re-publish every frame). A
 *  failure is never equal to anything — a still-broken derivation re-runs the
 *  subscriber, which is what heals it. */
function sameOutcome<T>(a: Outcome<T>, b: Outcome<T>): boolean {
  return (
    Result.isSuccess(a) &&
    Result.isSuccess(b) &&
    Object.is(a.success, b.success)
  );
}

/** Re-raise a derivation's throw at the read face. */
function openOutcome<T>(outcome: Outcome<T>): T {
  if (Result.isSuccess(outcome)) return outcome.success;
  throw outcome.failure;
}

/** A read-only LEVEL — the engine-free face every graph node exposes. `value` is
 *  the TRACKED read (reading it inside a derivation is depending on it); `peek()`
 *  is the untracked one. Deliberately no engine type: this is the reactor's
 *  public surface, and the next engine swap must not reach it. */
export interface ReadonlyLevel<T> {
  /** The current value, as a DEPENDENCY when read inside a derivation. */
  readonly value: T;
  /** The current value, tracking nothing. */
  peek(): T;
}

/** A writable level — {@link ReadonlyLevel} plus the setter, which is the one
 *  place a graph write can happen (and therefore the one place the batch is
 *  guaranteed). Internal: the graph is every node's one writer. */
interface MutableLevel<T> extends Omit<ReadonlyLevel<T>, "value"> {
  value: T;
}

/** ≙ `signal` — a mutable graph root. `keepAlive` because it carries STATE. */
function signal<T>(initial: T): MutableLevel<T> {
  const atom = Atom.writable<T, T>(
    () => initial,
    (ctx, next) => {
      ctx.setSelf(next);
    },
  ).pipe(Atom.keepAlive);
  return {
    get value(): T {
      return trackedRead(atom);
    },
    set value(next: T) {
      // The batch that Atom does not open for us — see the seam note.
      Atom.batch(() => {
        GRAPH.set(atom, next);
      });
      // THE DUAL EDGE. A derivation is allowed to write a level it just READ —
      // padi's finish-quiet generation does exactly that: `project()` depends on
      // the generation, then bumps it when the membership sync it performs
      // changed something. The engine invalidates a level's dependents by
      // CLEARING that level's dependent set, which, for the derivation that is
      // mid-recompute, drops an edge it already established and can no longer
      // re-establish — so the NEXT bump would reach nobody and the cell would
      // silently freeze. Re-assert the edge, and only for a level this
      // derivation genuinely read (a derivation that merely writes a level must
      // not acquire a dependency on it — that is a loop).
      if (currentGet !== undefined && currentDeps?.has(atom) === true) {
        currentGet(atom);
      }
    },
    peek: () => GRAPH.get(atom),
  };
}

/** ≙ `computed` — a lazily-pulled, glitch-free derivation. Auto-disposing (it is
 *  pure) and TOTAL (a throw becomes an {@link Outcome} and is re-raised at the
 *  read faces, never on the writer's stack). */
function derive<T>(compute: () => T): ReadonlyLevel<T> {
  const atom = Atom.readable<Outcome<T>>((get) =>
    withTracking(get, (): Outcome<T> => {
      try {
        return Result.succeed(compute());
      } catch (err) {
        return Result.fail(err);
      }
    }),
  ).pipe(Atom.withEquality(sameOutcome<T>));
  return {
    get value(): T {
      return openOutcome(trackedRead(atom));
    },
    peek: () => openOutcome(GRAPH.get(atom)),
  };
}

/** Discard a subscription's payload — the reactor's effects re-read through the
 *  level faces (which apply the error policy), never off the notification. */
const ignoreValue = (): void => {};

/** ≙ `effect` — run `body` now and after every change to whatever it read;
 *  returns the disposer. A disposed effect runs nothing on a later change. */
function effect(body: () => void): () => void {
  const node = Atom.readable<null>((get) =>
    withTracking(get, () => {
      body();
      return null;
    }),
  );
  return GRAPH.subscribe(node, ignoreValue, { immediate: true });
}

/** `batch` — group several graph writes into ONE frame, so derivations
 *  recompute once. The bridge owns the batch at every internal graph entry point
 *  (a source `emit`, a poll tick, every level write); this export is the ONE knob
 *  an app reaches for to coalesce a multi-member burst of ctx writes into a
 *  single recompute pass (e.g. `batch(() => { registry.set(a); registry.delete(b);
 *  })`). It is the engine's `batch`, surfaced through the reactor so app code
 *  never deep-imports the engine. */
export function batch<T>(run: () => T): T {
  let out!: T;
  Atom.batch(() => {
    out = run();
  });
  return out;
}

// ── Graph node ───────────────────────────────────────────────────────────

/** A node in the backend signal graph: a current LEVEL (the level every
 *  derivation reads) plus the disposer that tears down whatever it installed. A
 *  stateful node (a `scan`) additionally carries a `stopped` latch. */
export interface GraphNode<T> {
  /** The node's current value — a {@link ReadonlyLevel}, so reads are
   *  dependencies and writes are impossible from the outside. */
  readonly value: ReadonlyLevel<T>;
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
  readonly stopped: ReadonlyLevel<boolean>;
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
 *  asynchronously by `connectPoll`, which `derived.cell`/`derived.collection`
 *  drives. Its level is HONESTLY `T | undefined` — `undefined` in the pre-first-read
 *  window — so `GraphNode<T | undefined>`, NOT `GraphNode<T>`: a poll source must
 *  never masquerade as a synchronously-readable `T` (a `computed(() => poll.value)`
 *  wrapper would then seed `undefined` under a `T`-typed member). The dedicated
 *  `derived.cell`/`derived.collection` poll overloads recover the served `T` (the
 *  store seeds the spec default; each read publishes a `T`). */
export interface PollSource<T> extends GraphNode<T | undefined> {
  readonly [POLL_SOURCE_BRAND]: true;
  /** Do the T+0 seed read — its **first failure PROPAGATES** (the rejected
   *  promise faults the runtime's `done`, never a fabricated default) — publish it
   *  via `set`, then install the caller's tick cadence. Each later tick re-reads
   *  under a non-overlap (`inFlight`) guard and, on a read throw, LOG-SKIP-CONTINUEs
   *  (holds the last published value), never tearing down a long-lived poll.
   *  Returns the loop's disposer. Called once by `derived.cell`'s connect seam. The
   *  owned connector's `signal` (from the runtime) rides every read and, on abort,
   *  latches the poll's teardown so `close()` can't strand a seed or late-publish. */
  connectPoll(set: (next: T) => void, signal?: AbortSignal): Promise<Disposer>;
}

/** The poll argument shape of `source(...)`: an async `read` plus an `install`
 *  that owns the cadence (a `setInterval`, an `onState` force-resample, …). */
export interface PollSourceOptions<T> {
  /** The async poll read. The T+0 call is the seed (first failure propagates); a
   *  later call that throws is logged and skipped (the loop holds its last value).
   *  Receives the owned connector's `AbortSignal` (aborted on `close()`), which a
   *  cooperative read should honour so a slow read never strands a closing runtime;
   *  ignoring it is fine when the read always settles promptly. */
  read: (signal?: AbortSignal) => Promise<T>;
  /** Install the tick cadence: called once after the seed lands, handed a `tick`
   *  that triggers a guarded re-read. Return an uninstall fn (or nothing). */
  install: (tick: () => void) => SourceCleanup;
  /** What to call this source in a loop-guard error. Diagnostics only — it
   *  changes no behaviour, and it is what turns a freeze into a message naming
   *  the cell rather than a stack in framework code.
   *
   *  REQUIRED, and that is the whole of it. The guard exists because a
   *  self-caused poll loop froze a production server, and an unnamed crash
   *  reports the class of defect without saying which cell. "Name your poll
   *  sources" as a convention is a rule held by memory: the next fused cell is
   *  added by someone who has not read this comment, and the guard then fires
   *  anonymously on exactly the source nobody expected to loop. A required
   *  field is a compile error, which is what "no anonymous poll source" has to
   *  be. (The member key would be the ideal author of it, but it is bound at a
   *  seam this closure is already built by the time the walk reaches.) */
  label: string;
}

/** Whether a graph node is a POLL source (so `derived.cell` wires its async
 *  connect instead of the synchronous publish effect). Parameter is
 *  `GraphNode<T | undefined>` — a `PollSource<T>`'s honest base — so the predicate
 *  type is assignable to it (a `PollSource<T>` is NOT a `GraphNode<T>`, its level
 *  is `T | undefined`). */
function isPollSource<T>(
  node: GraphNode<T | undefined>,
): node is PollSource<T> {
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
/** The async context a poll read runs inside, carrying that poll's own identity.
 *
 *  This is the whole mechanism of the loop guard, and it replaced a timing
 *  heuristic that was refuted in both directions. `AsyncLocalStorage` propagates
 *  across `await`s and promise continuations, so anything the read causes —
 *  synchronously on its stack, or in the continuations it schedules — observes
 *  this store. A timer callback, an I/O completion, or another cell's microtask
 *  burst does NOT: it carries whatever context it was scheduled in.
 *
 *  So "was this tick caused by the read it is about to re-trigger?" stops being a
 *  guess about elapsed milliseconds and becomes a fact about causation. */
const READ_CONTEXT = new AsyncLocalStorage<object>();

/** How many consecutive SELF-CAUSED ticks make it a loop rather than a
 *  coincidence. Three, because a read may legitimately cause one edge in passing
 *  (it wrote something another part of the system watches), while a true cycle
 *  produces them without bound and reaches three immediately. Deliberately a
 *  constant and not an option: a threshold a consumer can raise is a threshold
 *  that gets raised to silence the crash it exists to cause. */
const SELF_CAUSED_STREAK = 3;

/** TEST-ONLY. Where a loop report goes instead of being thrown.
 *
 *  Not a consumer knob and deliberately not a `PollSourceOptions` field: there is
 *  no per-source setting that can silence this crash. It exists because
 *  `assertCellConverges` (surface's authoring-time convergence helper) has to be
 *  able to OBSERVE a loop without taking the test process down with it, and
 *  because the tests that prove the guard does not fire need something to assert
 *  emptiness on. Production leaves it null and the guard throws. */
let testLoopReporter: ((err: Error) => void) | null = null;

/** TEST-ONLY — see {@link testLoopReporter}. Returns the RESTORE for whatever
 *  was installed before.
 *
 *  A restore rather than a "pass null to reset", because `null` was doing two
 *  jobs — "no reporter installed" and "put it back the way it was" — and the
 *  second is a claim the caller cannot make: nesting is legitimate (two
 *  convergence assertions in one process, a helper called from a test that
 *  installed its own), and a caller that nulled on the way out would disarm a
 *  reporter it never installed. The inner one finishing would then send the
 *  outer's loop report down the production path — `queueMicrotask(() => throw)`,
 *  surfacing as an unhandled rejection attributed to the wrong test, which is
 *  the hardest possible way to debug the guard that exists to make freezes
 *  debuggable. */
export function __setLoopReporterForTests(
  fn: ((err: Error) => void) | null,
): () => void {
  const prior = testLoopReporter;
  testLoopReporter = fn;
  return () => {
    testLoopReporter = prior;
  };
}

/** Say it, loudly. Default is a throw on its own turn — an unbounded cycle must
 *  be a crash with a stack, not a process that stops answering. */
function reportSelfCausedLoop(label: string): void {
  const err = new Error(
    `surface reactor: the poll source "${label}" is re-reading itself — ${SELF_CAUSED_STREAK} ` +
      "consecutive re-reads were triggered by a change edge fired from inside this source's OWN read " +
      "(same async context), which is an unbounded cycle (it froze a production server: HTTP dead, " +
      "SIGTERM ignored). Report the reconciled value by RETURNING it — the poll publishes what the " +
      "read returns.",
  );
  if (testLoopReporter !== null) {
    testLoopReporter(err);
    return;
  }
  queueMicrotask(() => {
    throw err;
  });
}

export function everyMs(ms: number): (tick: () => void) => SourceCleanup {
  return (tick) => {
    const iv = setInterval(tick, ms);
    iv.unref();
    return () => clearInterval(iv);
  };
}

/** A poll `source` `install` that fires on the fixed {@link everyMs} interval AND
 *  the instant a caller-supplied change signal fires — the fused cadence for a poll
 *  whose value can move faster than its coarse interval. `subscribe` is any
 *  edge-source: it receives the source's `tick` and returns an unsubscribe (a
 *  reconnect/state feed, a config-changed hook, an fs-watch — the reactor names no
 *  domain). Both the interval and the subscription tear down on cleanup.
 *
 *  `source({ read, install: everyMsOr(5_000, onChange) })` re-reads every 5s AND the
 *  moment `onChange` fires — so a change edge is reflected at once rather than up to a
 *  full interval later, while the interval still covers drift the edge doesn't signal.
 *  The one home for the interval-plus-edge fuse every such poll would otherwise
 *  re-spell (previously duplicated as app-local `everyMsOrOnState`/
 *  `everyMsOrOnDaemonChange` twins). */
export function everyMsOr(
  ms: number,
  subscribe: (tick: () => void) => () => void,
): (tick: () => void) => SourceCleanup {
  return (tick) => {
    const stopInterval = everyMs(ms)(tick);
    // Transactional setup: the interval is live before `subscribe`, so if the edge
    // subscription throws, roll the interval back rather than leaking a timer that
    // wakes forever against a tick nothing owns.
    let off: () => void;
    try {
      off = subscribe(tick);
    } catch (err) {
      stopInterval?.();
      throw err;
    }
    // Cleanup tears down BOTH arms: `finally` runs `stopInterval` even if `off`
    // throws, so a faulty unsubscribe can't strand the interval (the both-teardown
    // contract this fuse documents).
    return () => {
      try {
        off();
      } finally {
        stopInterval?.();
      }
    };
  };
}

/** The POLL source (`source({ read, install })`). Owns the T+0-seed /
 *  non-overlap / log-skip-continue policy the note assigns to "the bridge"; a
 *  `derived.cell` drives it via {@link PollSource.connectPoll}. Unlike the push
 *  source it has no per-occurrence `subscribe` (a poll level has no per-emission
 *  meaning — it is sampled), so it is not a `scan` input; it is published
 *  directly as a cell (or a collection). */
function pollSource<T>({
  read,
  install,
  label,
}: PollSourceOptions<T>): PollSource<T> {
  const level = signal<T | undefined>(undefined);
  let inFlight = false;
  // ── The self-caused-tick loop guard ──────────────────────────────────
  //
  // A poll on a FUSED cadence (`everyMsOr`) re-reads on an edge as well as a
  // clock. A read that ANNOUNCES on that same edge closes a circle the reactor
  // will execute forever — read → announce → tick → read — and the failure mode
  // is a whole-process freeze that outranks SIGTERM. It happened in production.
  //
  // The question is CAUSATION, and it is asked directly rather than inferred:
  // every read runs inside {@link READ_CONTEXT} carrying this source's own
  // token, so a tick that fires while that store is visible was caused by this
  // read — on its stack or in a continuation it scheduled. A timer, an I/O
  // completion, another cell's microtask burst: different context, never counted.
  //
  // The first version of this guard asked about TIMING and value-equality
  // instead, and was refuted both ways: a healthy poll slower than its interval
  // crashed (every coalesced trailing read looked "immediate"), while measuring
  // laps instead would have missed the real freeze (a self-loop's lap is just its
  // read duration). Timing is a proxy for causation; this is causation.
  const identity = {};
  let selfCausedStreak = 0;
  let looped = false;
  // A tick that arrived while a read was in flight LATCHES here instead of being
  // dropped — the non-overlap guard coalesces a burst, but a trailing read after
  // the current one lands so a genuine change edge (a `install` force-resample) is
  // never lost to overlap.
  let dirty = false;
  let uninstall: (() => void) | undefined;
  let disposed = false;
  // The owned connector's abort signal (threaded from `connectPoll`) — passed to
  // every `read` for cooperative cancellation, and its `abort` LATCHES `disposed`
  // so a `close()` during the seed read can't late-publish/install (and the read,
  // if it respects the signal, unblocks a `close()` waiting on it).
  let connSignal: AbortSignal | undefined;
  // A read rejection caused by OUR OWN abort (a `close()` cancelling a cooperative
  // read) is expected shutdown noise, not a poll failure — distinguished so it is
  // neither logged nor propagated as a fault.
  const isOwnedAbort = (): boolean => disposed || connSignal?.aborted === true;

  // One guarded, publishing read for a LATER tick: latch (don't drop) if a read is
  // in flight, skip if torn down; on success publish to the level (for `$` readers)
  // and through `set` (the wire). Route the call through `Promise.resolve().then(read)`
  // so a SYNCHRONOUS throw from `read` (a throw-only fn is type-compatible via `never`)
  // lands on the SAME logged-skip path as a rejected promise — a bare `read().then(...)`
  // would let a sync throw escape the interval/event callback and wedge `inFlight` true.
  // The trailing `.catch` covers BOTH a read rejection AND a publisher (`set`) throw —
  // the later-tick fault class is LOG-SKIP-CONTINUE (hold the last published value, never
  // tear down a long-lived poll), symmetric with the seed transaction's read+publish
  // guard but NON-fatal here. Without it a publisher throw would become an UNHANDLED
  // rejection, since nothing awaits this chain.
  const tickRead = (set: (next: T) => void): void => {
    if (disposed || looped) return;
    // Was this tick caused by THIS source's own read? Asked at the moment the
    // tick arrives, because that is when its async context is the caller's.
    // Note it is asked BEFORE the coalescing return: a self-caused tick that
    // lands mid-read is exactly the cycle's signature, and the trailing read it
    // schedules is the next lap.
    if (READ_CONTEXT.getStore() === identity) {
      selfCausedStreak += 1;
      if (selfCausedStreak >= SELF_CAUSED_STREAK) {
        looped = true;
        reportSelfCausedLoop(label);
        return;
      }
    } else {
      // Any tick the world caused resets the run: a cycle is CONSECUTIVE
      // self-causation, and a source that also receives real edges is alive.
      selfCausedStreak = 0;
    }
    runRead(set);
  };

  /** Do the read. Separate from {@link tickRead} because the COALESCED trailing
   *  read is dispatched from our own `.finally` — it is the continuation of a
   *  tick already accounted for, not a new one, and running it through the
   *  accounting would reset the self-caused run on every lap (which is exactly
   *  what a cycle does, so the guard would never fire). */
  const runRead = (set: (next: T) => void): void => {
    if (disposed || looped) return;
    if (inFlight) {
      dirty = true; // coalesce; a trailing read runs when the current one finishes
      return;
    }
    inFlight = true;
    Promise.resolve()
      // Inside the source's own context, so anything this read causes — now or
      // in a continuation — is attributable to it.
      .then(() => READ_CONTEXT.run(identity, () => read(connSignal)))
      .then((v) => {
        if (disposed) return;
        level.value = v;
        set(v);
      })
      .catch((err) => {
        // Suppress our own cancellation (a `close()` aborted this read); log a GENUINE
        // later-tick failure (read OR publish) and hold the last published value.
        if (isOwnedAbort()) return;
        console.error(
          "reactor: poll source tick threw — holding last published value",
          err,
        );
      })
      .finally(() => {
        inFlight = false;
        // An edge that arrived mid-read latched `dirty` — do the trailing read now
        // so a change is never lost to the non-overlap guard.
        if (dirty && !disposed) {
          dirty = false;
          runRead(set);
        }
      });
  };

  const teardownLoop = (): void => {
    const u = uninstall;
    uninstall = undefined;
    u?.();
  };

  return {
    // The level is HONESTLY `T | undefined` (undefined until the first read), and
    // the public `PollSource<T> extends GraphNode<T | undefined>` says exactly that
    // — no cast, so a caller can never read it as a synchronously-ready `T`.
    value: level,
    [POLL_SOURCE_BRAND]: true,
    connectPoll: async (set, signal) => {
      // The owned connector's abort is the poll's teardown trigger: it LATCHES
      // `disposed` (so the post-seed guard below suppresses a late publish/install
      // if `close()` raced the seed) and tears down any installed loop. Abort BEFORE
      // the seed even starts is honoured too.
      connSignal = signal;
      signal?.addEventListener(
        "abort",
        () => {
          disposed = true;
          teardownLoop();
        },
        { once: true },
      );
      if (signal?.aborted) return () => {};
      // Install the cadence + any change-listener BEFORE the T+0 seed, so a change
      // edge (a kaval connect) that fires DURING the async seed is LATCHED (`dirty`,
      // via `tickRead`'s in-flight branch) instead of lost to a not-yet-subscribed
      // listener — a trailing read after the seed then reflects it (a DURABLE
      // readiness edge, not one that survives only if it lands after `install`).
      // `inFlight = true` fences those during-seed ticks so none races the seed's
      // own publish; they coalesce into the single post-seed trailing read.
      inFlight = true;
      uninstall = install(() => tickRead(set)) ?? undefined;
      // The whole seed TRANSACTION is guarded — the T+0 read AND its publication:
      // `install` ran above, so the cadence must be rolled back on EVERY non-success
      // exit, not just a read rejection. A read failure PROPAGATES (mirror-never-
      // fabricate: no default stands in for an unread poll); a publisher throw at
      // `set(seed)` (a cell write hook / a collection reconcile publisher) is the SAME
      // fault class — connect must reject with the cadence already torn down, never
      // leave it polling a failed publisher with the disposer never adopted.
      try {
        // The signal rides the read so a cooperative reader unblocks a `close()`
        // waiting on a slow seed.
        // ⚠ POLL-READ AUTHORS: a `read` that THROWS here tears down this cadence
        // PERMANENTLY (the seed failure propagates + rolls back the install), so under
        // a caller whose `runtime.done` handler is non-fatal (logs, no restart) the cell
        // then serves its spec DEFAULT for the process's life — no retry. Keep a poll
        // `read` TOTAL (catch transient errors → best-effort/last value); reserve a throw
        // for a DETERMINISTIC boot defect that genuinely SHOULD be fatal.
        const seed = await READ_CONTEXT.run(identity, () => read(signal));
        inFlight = false;
        // Disposed mid-seed (the runtime closed before the first read landed): tear the
        // cadence down and publish nothing — hand back a no-op disposer.
        if (disposed) {
          teardownLoop();
          return () => {};
        }
        level.value = seed;
        set(seed); // a throwing publisher lands in the catch below → cadence torn down
        // A change edge during the seed latched `dirty` — do the trailing read now so a
        // kaval that connected mid-seed is reflected at once, not one cadence later.
        if (dirty) {
          dirty = false;
          tickRead(set);
        }
        return teardownLoop;
      } catch (err) {
        inFlight = false;
        // Roll back the cadence installed above, whichever way the transaction ended.
        teardownLoop();
        // An OWNED abort (a `close()` cancelling the seed) is a CLEAN close, not a
        // fault — never fault `done`; hand back a no-op disposer. A GENUINE seed read
        // OR publisher failure still propagates (first-failure-propagates).
        if (isOwnedAbort()) return () => {};
        throw err;
      }
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
  readonly connect: (
    cell: { set: (next: T) => void },
    opts?: { signal?: AbortSignal },
  ) => Disposer | Promise<Disposer>;
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

/** A POLL-source derived cell — the shape `derived.cell(source({ read, install }))`
 *  returns. It is a {@link DerivedCell} whose SYNCHRONOUS face is honestly
 *  `T | undefined`, NOT `T`: a poll source has no value until its async T+0 seed
 *  lands, so `store.get()` and `siblingRead()` read `undefined` before the seed —
 *  and this type SAYS so, rather than laundering `undefined` into `T`. The wire is
 *  never served this `undefined`: the boot walk seeds the private serving store from
 *  the spec DEFAULT (a `T`) and registers the `$` sibling as that mirror, so the
 *  served value and every `$`-read are a `T`; the `connect` seam publishes a `T` on
 *  each read. The two `T | undefined` methods are the honest declaration of what the
 *  DEP's own facade returns pre-seed — the server path does not consult them for a
 *  poll cell (it uses the spec-default mirror), and no consumer legitimately reads a
 *  dep's internal store, but the type must not lie about them. */
export interface PollDerivedCell<T>
  extends Omit<DerivedCell<T>, "store" | "siblingRead"> {
  readonly store: CellStore<T | undefined>;
  siblingRead(): T | undefined;
  readonly [DERIVED_POLL_BRAND]: true;
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
  return { value: derive(compute), dispose: () => {} };
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
  signal?: AbortSignal,
): Promise<Disposer> {
  return poll.connectPoll(onValue, signal).then((loopDispose) => {
    if (isTorn()) {
      loopDispose();
      return () => {};
    }
    adopt(loopDispose);
    return teardown;
  });
}

/** The one-shot connect guard shared by every derived builder (cell, compute cell,
 *  collection): a derived member wires EXACTLY ONE subscription, and only while it is
 *  live. Connecting after teardown (a standalone `dispose()` ran first) would install a
 *  subscription whose returned teardown is a permanent no-op (`torn` is already set) — a
 *  silent leak; connecting twice would strand the first. Crash loudly rather than model
 *  either impossible state. `label` names the builder in the thrown message. */
function assertOneShotConnect(
  torn: boolean,
  connected: boolean,
  label: string,
): void {
  if (torn) {
    throw new Error(
      `${label}: connect() after dispose() — already torn down (one-shot lifecycle)`,
    );
  }
  if (connected) {
    throw new Error(
      `${label}: connect() called twice — wires exactly one subscription`,
    );
  }
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
    connect: (cell, opts) => {
      assertOneShotConnect(torn, connected, "derived cell");
      connected = true;
      if (poll) {
        // A poll source connects ASYNCHRONOUSLY (see `connectPollNode`): the T+0
        // seed read faults the runtime's `done` on rejection — a boot crash,
        // never a fabricated default. The owned connector's `signal` rides in so
        // `close()` during the seed cooperatively cancels it (no late publish).
        return connectPollNode(
          poll,
          (next) => cell.set(next),
          () => torn,
          (d) => {
            disposeEffect = d;
          },
          teardown,
          opts?.signal,
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
  let node: ReadonlyLevel<T> | undefined;
  const unsubscribes: Array<() => void> = [];
  let disposeEffect: (() => void) | undefined;
  let connected = false;
  let torn = false;

  const requireNode = (): ReadonlyLevel<T> => {
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
    //     sibling's post-equals change. Both reads happen inside the `derive`
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
    node = derive(() => compute(siblings));
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
      assertOneShotConnect(torn, connected, "derived compute cell");
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
    // wrapped publisher fires. Deleting the just-yielded key from `current` during
    // its own `keys()` iteration is well-defined (a Map iterator skips deleted keys),
    // so the removal pass needs no snapshot copy.
    for (const [k, v] of next) {
      if (!current.has(k) || !pub.equals(current.get(k) as V, v)) {
        current.set(k, v);
        pub.upsert(k, v);
      }
    }
    for (const k of current.keys()) {
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
    connect: (publishers, opts) => {
      assertOneShotConnect(torn, connected, "derived collection");
      connected = true;
      const pub = {
        upsert: (k: K, v: V) => publishers.upsert(k, v),
        remove: (k: K) => publishers.remove(k),
        equals: publishers.equals as (a: V, b: V) => boolean,
      };
      if (poll) {
        // Async (see `connectPollNode`): the seed read gives the first whole map
        // (reconciled against the empty baseline ⇒ every key upserted), then each
        // tick's map reconciles. A first-read rejection faults the runtime's `done`;
        // the owned connector's `signal` cancels a seed a `close()` races.
        return connectPollNode(
          poll,
          (nextMap) => reconcile(nextMap, pub),
          () => torn,
          (d) => {
            disposeReconcile = d;
          },
          teardown,
          opts?.signal,
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

// ── reactiveFamily — a keyed family of member states as a graph source ─────

/** What {@link reactiveFamily} needs from its caller. */
export interface ReactiveFamilyOptions<K, S> {
  /** Emits the CURRENT member-key list on every membership change; its level
   *  (`source`'s `initial`) seeds the T+0 set. ONE occurrence per transition — the
   *  family diffs each frame against the live set (never coalescing a remove+re-add,
   *  which is the map's clause-3 the `membershipId` mint rests on). */
  readonly members: Source<readonly K[]>;
  /** Subscribe ONE member's state: `set(state)` caches the frame (last-frame hold)
   *  and pokes the family's change edge. Called once per key ENTRY; a
   *  snapshot-then-delta source seeds synchronously (its `set` fires inside `attach`).
   *  Returns the member's disposer, run on key EXIT and on family dispose.
   *
   *  Return `undefined` to signal "NOTHING TO SUBSCRIBE YET — retry me" (a transient race,
   *  e.g. a member present in the key list before its backing session has landed). The
   *  family then does NOT mark the key attached, so the next membership frame RETRIES the
   *  attach — a self-heal, NOT a defect (never fabricate a no-op disposer that freezes the
   *  member as un-seeded forever). Return a real disposer once the subscription is live. */
  readonly attach: (key: K, set: (state: S) => void) => Disposer | undefined;
  /** Per-key disposal hook, run AFTER the member disposer on key exit (and on family
   *  dispose) — the seam an app hangs per-key cleanup on (a memo eviction, a link
   *  cache delete). Optional; contained (a throw is logged, never aborts teardown). */
  readonly onEvict?: (key: K) => void;
}

/** A keyed family of member states — the graph SOURCE the SR9 `serveHostMap` reshape
 *  stands on. Owns, ONCE and for every consumer: membership diff (attach entrants,
 *  detach+evict leavers), last-frame hold (each member's latest state cached),
 *  per-key disposal, and per-member error isolation (one member's `attach`/`set`
 *  throw is contained + logged, never aborting a sibling or the membership frame).
 *
 *  Exposes BOTH faces the fate-of-the-seven-names split names: the pull accessors
 *  `derived.registry` reads (`keys`/`has`/`get`/`subscribe`) AND a GraphNode `.value`
 *  map signal (the face a future `derived.collection` consumer would read — no
 *  consumer today, so its fresh-copy recompute is a lazy computed nobody pulls). */
export interface ReactiveFamily<K, S> extends GraphNode<ReadonlyMap<K, S>> {
  /** The live member keys (attached membership — includes a key whose first state
   *  frame has not landed yet; its `get` is `undefined` until it does). */
  keys(): K[];
  /** Whether a key is a live member. */
  has(key: K): boolean;
  /** One member's cached last-frame state, or `undefined` (absent, or attached but
   *  not yet seeded — a source whose `onState` has not fired its first frame). */
  get(key: K): S | undefined;
  /** Fire `onChange` on every family change — a membership transition OR any member's
   *  state frame — but NOT on subscribe (a reader reads the current set via
   *  `keys`/`get`; the change edge reports only transitions). Returns an unsubscribe.
   *  A throwing `onChange` is contained and rethrown out-of-band (fail-loud, never a
   *  silent degrade), so one listener's defect neither aborts a sibling nor tears down
   *  the writer's stack. */
  subscribe(onChange: () => void): () => void;
}

export function reactiveFamily<K, S>(
  opts: ReactiveFamilyOptions<K, S>,
): ReactiveFamily<K, S> {
  // The live member states, keyed by the family's own key and mutated IN PLACE
  // (last-frame hold). A version signal — NOT a fresh map per change — is the change
  // edge, so a firehose of state frames costs O(1) per poke, never O(M) re-allocating
  // the whole map (the SR7/SR8 compose-fold lesson, applied to the source side).
  const latest = new Map<K, S>();
  // The current MEMBERSHIP — the last membership frame's key set. This (NOT the attached
  // set below) is what `keys`/`has` report: a member is reported the moment the source lists
  // it, even before its `attach` has installed a subscription (its `get` is `undefined` then,
  // and a not-yet-attached member is retried on the next frame). This mirrors the old adapter
  // reporting a pool member before its first `onState` frame (→ `projectState(undefined)`),
  // and — crucially — keeps a member whose source is *permanently* absent VISIBLE so the
  // consumer's `resolve` fails loud on it, rather than silently dropping it.
  let memberSet = new Set<K>();
  // Attached subset: key → its member disposer. A member in `memberSet` but not here is
  // present-but-not-yet-subscribed (its `attach` returned `undefined` — retried each frame).
  const disposers = new Map<K, Disposer>();
  // Per-attachment generation token. Each `attach` mints a fresh object; the member's
  // `set` callback is honoured ONLY while its token is still the current one for that key
  // AND the family is live. A late frame from a torn-down / superseded attachment (a racy
  // session whose `onState` fires after its disposer, or after a detach + same-key re-add,
  // or after `dispose()`) is then a fenced no-op — it can never corrupt a detached or
  // re-added key's state nor resurrect an evicted member. (The push-`source`'s generation
  // fence, applied per member.)
  const tokens = new Map<K, object>();
  // The pull-face's DIRECT listeners — fired synchronously, once per completed change edge
  // (the old hand-rolled `fire()` fan-out). They are NOT driven off the `version` signal:
  // an engine effect over `version` COALESCES two edges that land in one outer batch, which
  // would fold a same-key remove + re-add into a single notification and leave `members()`
  // showing the key continuously present — violating the map's clause-3 (the `membershipId`
  // mint, and the client's per-key lifecycle, rest on remove and re-add being TWO observable
  // edges). The direct fan-out cannot coalesce. `version` stays ONLY for the lazy GraphNode
  // `.value` face (a future `derived.collection` consumer), where coalescing is harmless.
  const listeners = new Set<() => void>();
  const version = signal(0);
  let disposed = false;
  // While a `reconcile` runs, per-member seed frames DON'T fire individually — the one
  // trailing `fire()` covers the whole membership frame (all its seeds + the membership
  // delta) as a SINGLE edge. A state frame OUTSIDE a reconcile fires on its own. So one
  // membership frame is one edge, and two membership frames (remove, then re-add) are two.
  let reconciling = false;

  // Fail LOUD, out-of-band — NEVER `console.error`-and-continue. A reactiveFamily producer
  // defect (a failed `attach` that would make an authoritative member silently vanish, a
  // teardown leak, a republish throw) must crash the process on the next microtask, not
  // degrade to an empty or stale-but-healthy state (the design philosophy's fail-fast /
  // caught-error-must-not-collapse-to-empty). Sibling isolation is preserved: the current
  // frame finishes and siblings are untouched, THEN the invariant surfaces.
  const failLoud = (msg: string, err: unknown): void => {
    queueMicrotask(() => {
      throw new Error(`reactor: reactiveFamily ${msg}`, { cause: err });
    });
  };

  // ONE change edge: bump the (coalescing) `.value`-face version, then fan out to the
  // pull-face listeners directly and synchronously. A listener throw is contained (a
  // sibling still fires) and rethrown out-of-band.
  const fire = (): void => {
    version.value++;
    for (const l of [...listeners]) {
      try {
        l();
      } catch (err) {
        failLoud("change listener threw — an invariant/producer defect", err);
      }
    }
  };

  // Attach ONE key: subscribe its state (a snapshot-then-delta source seeds synchronously
  // here). Idempotent (an already-attached key is a no-op). PER-MEMBER ERROR ISOLATION +
  // FAIL-FAST: a throw from `attach` (or the seeding `set` it drives synchronously) rolls
  // back any partial state, invalidates the token, and FAILS LOUD — a producer defect, not
  // a silently-dropped member — while leaving siblings' attachment untouched.
  const attachKey = (key: K): void => {
    if (disposers.has(key)) return;
    const token = {};
    tokens.set(key, token);
    const set = (state: S): void => {
      // Fence: honour a frame ONLY from the CURRENT attachment of a LIVE family.
      if (disposed || tokens.get(key) !== token) return;
      latest.set(key, state);
      if (!reconciling) fire(); // during a reconcile, the trailing fire covers the seed
    };
    let off: Disposer | undefined;
    try {
      off = opts.attach(key, set);
    } catch (err) {
      tokens.delete(key);
      latest.delete(key); // roll back a synchronous seed the throwing attach left behind
      failLoud(
        "attach for a member threw — a producer defect (an authoritative member must " +
          "never silently vanish)",
        err,
      );
      return;
    }
    if (off === undefined) {
      // `attach` signalled "nothing to subscribe yet — retry me" (a transient race, e.g. a
      // member present before its session lands). Do NOT mark the key attached: leave it out
      // of `disposers` so the NEXT membership frame re-runs `attachKey` for it (a self-heal),
      // and roll back the token + any synchronous seed. Never fabricate a no-op disposer —
      // that would freeze the member as un-seeded forever (the drishti#102 class of bug).
      tokens.delete(key);
      latest.delete(key);
      return;
    }
    disposers.set(key, off);
  };

  // Detach ONE key: invalidate its token FIRST (so a late frame is fenced), run its
  // disposer, evict its cached state, fire `onEvict`. A disposer / `onEvict` throw fails
  // loud (a teardown leak is a defect), never a silent swallow.
  const detachKey = (key: K): void => {
    const off = disposers.get(key);
    disposers.delete(key);
    tokens.delete(key);
    latest.delete(key);
    try {
      off?.();
    } catch (err) {
      failLoud("member disposer threw during detach — a teardown leak", err);
    }
    try {
      opts.onEvict?.(key);
    } catch (err) {
      failLoud("onEvict threw during detach", err);
    }
  };

  // Diff a membership frame against the live set: adopt it as the new `memberSet`, attach
  // entrants (retrying any that are present-but-not-yet-subscribable), detach departed
  // ATTACHED members, then fire ONE edge. `members` fires one occurrence per pool transition
  // (never coalescing), so each frame is a single-transition delta and one observable edge.
  const reconcile = (keys: readonly K[]): void => {
    const next = new Set(keys);
    reconciling = true;
    try {
      memberSet = next; // membership = the frame (a present-but-unattached member is retried)
      for (const key of next) attachKey(key);
      for (const key of [...disposers.keys()]) {
        if (!next.has(key)) detachKey(key);
      }
    } finally {
      reconciling = false;
    }
    fire();
  };

  // Subscribe the membership source (installs its tap), THEN reconcile the current
  // level as the T+0 seed — an occurrence that fires during install is idempotent
  // against the seed (attach is a no-op for a live key; detach handles a leaver).
  const offMembers = opts.members.subscribe((keys) => reconcile(keys));
  reconcile(opts.members.value.peek() ?? []);

  return {
    // The GraphNode value face: a FRESH copy per recompute so a downstream `!==`
    // consumer detects a change (the in-place `latest` never changes ref). Lazy — the
    // O(M) copy is paid only if a `.value.value` consumer (a future `derived.collection`
    // over the family) exists; the pull-face `derived.registry` never reads it.
    value: derive(() => {
      version.value; // track
      return new Map(latest);
    }),
    keys: () => [...memberSet],
    has: (key) => memberSet.has(key),
    get: (key) => latest.get(key),
    // The pull-face change edge: a DIRECT listener registration (fired synchronously by
    // `fire`, once per completed change edge — never on subscribe, and never coalesced
    // across membership frames). Returns an unsubscribe.
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true; // fences any late `set` callback from a member being torn down
      offMembers();
      // Detach every member (disposer + onEvict). NO final fire — a change edge after
      // teardown would fire a still-subscribed listener into a torn-down family; the
      // listeners' owners release them (`subscribe` returns their disposer).
      for (const key of [...disposers.keys()]) detachKey(key);
      memberSet = new Set();
      listeners.clear();
    },
  };
}

// ── derived.registry — the pull-face MapRegistry exit over a family ────────

/** The pull-face exit over a {@link ReactiveFamily} — SR9's split of the old
 *  `registryFromFamily` along the source/exit axis (`reactiveFamily` the graph source,
 *  this the pull face). Resolves each member's entry ON DEMAND from the family's cached
 *  state (never materializing the whole entry map — the map's `resolve(k)` is per-key),
 *  and fires `subscribe` on every family change. */
export interface DerivedRegistry<K, Entry> {
  members(): K[];
  has(key: K): boolean;
  /** Resolve one member's entry from its cached state (which may be `undefined`
   *  pre-first-frame — the `resolve` fn handles that arm). Throws if the key is not a
   *  member (a caller resolving a non-member is a defect, not an empty result). */
  resolve(key: K): Entry;
  subscribe(onChange: () => void): () => void;
  /** Tear down the backing family (its membership sub + every member disposer). */
  dispose(): void;
}

function derivedRegistry<K, S, Entry>(
  family: ReactiveFamily<K, S>,
  resolve: (key: K, state: S | undefined) => Entry,
): DerivedRegistry<K, Entry> {
  return {
    members: () => family.keys(),
    has: (key) => family.has(key),
    resolve: (key) => {
      if (!family.has(key)) {
        throw new Error(
          `derived.registry: resolve of non-member key ${String(key)} — the caller ` +
            "asked to resolve a key that is not a live member.",
        );
      }
      return resolve(key, family.get(key));
    },
    subscribe: (onChange) => family.subscribe(onChange),
    dispose: () => family.dispose(),
  };
}

/** The reactor's wire exits. Phase 0 shipped the graph-node `cell`; SR7 adds the
 *  compute-fn overload (`derived.cell(($) => …)`); SR8 adds `collection`; SR9 adds
 *  the keyed `registry` (the pull-face exit over a `reactiveFamily`).
 *  Namespaced (`derived.cell`) so the read-only-projection intent is legible at
 *  every declaration site. */
interface DerivedApi {
  /** Publish a pre-built graph node (a `scan`, a `computed`) as a cell — seeds
   *  from the node's current level by an eager pull at wiring (a throw is a boot
   *  crash), and every level change flows through the member's own `equals →
   *  onWrite → store.set → bus.publish` gate via the `connect` setter, so the
   *  wire dedup point is unchanged. */
  /** Publish a POLL `source({ read, install })` as a cell — the dedicated poll
   *  overload, FIRST so a `PollSource<T>` binds `T` (not `T | undefined`): the
   *  served value is a `T` (the store seeds the spec default; each read publishes
   *  a `T`), even though the source's own level is honestly `T | undefined` until
   *  the seed. Without this overload a poll source would fall to the graph-node
   *  form below as `GraphNode<T | undefined>` and the cell would type `T | undefined`.
   *  Returns a {@link PollDerivedCell} — its synchronous `store.get()`/`siblingRead()`
   *  face is honestly `T | undefined` (undefined until the seed), while its `connect`
   *  publishes `T` and the served value is the spec default until the first read. */
  cell<T>(node: PollSource<T>): PollDerivedCell<T>;
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
  /** Poll overload, FIRST so a `PollSource<ReadonlyMap<K, V>>` binds `K`/`V` from
   *  the served map (not `ReadonlyMap<K, V> | undefined`) — the seed reads the
   *  first whole map. */
  collection<K, V>(
    node: PollSource<ReadonlyMap<K, V>>,
  ): DerivedCollectionBranded;
  collection<K, V>(
    node: GraphNode<ReadonlyMap<K, V>>,
  ): DerivedCollectionBranded;
  /** The pull-face exit over a {@link ReactiveFamily} — `derived.registry(family,
   *  (key, state) => entry)`. Resolves each member's entry on demand from the
   *  family's cached state and fires `subscribe` on every family change; the split
   *  of the old `registryFromFamily` along the source/exit axis. */
  registry<K, S, Entry>(
    family: ReactiveFamily<K, S>,
    resolve: (key: K, state: S | undefined) => Entry,
  ): DerivedRegistry<K, Entry>;
}

export const derived: DerivedApi = {
  cell(
    arg: GraphNode<unknown> | ((siblings: SiblingRead<SurfaceSpec>) => unknown),
    // biome-ignore lint/suspicious/noExplicitAny: the two overloads' return types are the public contract; the impl is intentionally loose
  ): any {
    return typeof arg === "function" ? computeCell(arg) : graphNodeCell(arg);
  },
  collection<K, V>(
    node: GraphNode<ReadonlyMap<K, V>> | PollSource<ReadonlyMap<K, V>>,
  ): DerivedCollectionBranded {
    // A `PollSource<ReadonlyMap>` is a `GraphNode<ReadonlyMap | undefined>`; the
    // reconciler reads the whole map through `connectPoll` (never the level), so
    // narrowing `undefined` away here is honest — `derivedCollection` re-detects the
    // poll brand and drives the async seed.
    return derivedCollection(node as GraphNode<ReadonlyMap<K, V>>);
  },
  registry: derivedRegistry,
};
