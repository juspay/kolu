/**
 * The brand that marks a cell dep as a reactor DERIVED cell — a cell whose
 * value is a projection of the backend signal graph, so the graph is its ONE
 * writer.
 *
 * Kept in its own tiny, import-free module on purpose: `server.ts`'s boot walk
 * (`walkSurface`) reads the brand to enforce a derived member is wire-read-only,
 * but `server.ts` must NOT import `reactor.ts` (which imports the signals
 * engine) — that would both pull the engine into `server.ts`'s module graph and
 * form an import cycle (`reactor.ts` imports `server.ts`'s `CellStore`). With the
 * brand here, `server.ts` and `reactor.ts` each import this leaf and the engine
 * stays reachable only through `reactor.ts` — the lint ban's one exit.
 */

/** Property key branding a `derived.cell(...)` dep. `Symbol.for` (not a fresh
 *  `Symbol`) so the brand survives duplicate-module-instance edge cases (a test
 *  harness, a bundler double-load) — identity is by the registered key, not by
 *  module singleton. */
export const DERIVED_CELL_BRAND: unique symbol = Symbol.for(
  "kolu.surface.reactor.derivedCell",
);

/** Structural shape a `derived.cell(...)` dep carries so the boot walk can spot
 *  it without importing `reactor.ts`. */
export interface DerivedCellBranded {
  readonly [DERIVED_CELL_BRAND]: true;
  /** An ENGINE-TRACKED read of this derived member's graph node — the reactor
   *  reads its `computed`/`scan` signal LIVE, so a sibling that reads it (via `$`)
   *  inside its OWN computed depends on this node DIRECTLY. That is the bridge's
   *  law "a derived member's graph face is its computed, never its mirror": a
   *  derived-reads-derived chain becomes a pure computed graph, glitch-free by the
   *  engine's version-checked lazy pull (a downstream read always pulls the fresh
   *  upstream value), never the push-lagging mirror an authored sibling exposes.
   *  The boot walk registers THIS as the sibling source for a derived cell (and
   *  holds it as an opaque closure — the walk never touches a signal). */
  siblingRead(): unknown;
}

/** Whether a cell dep is a reactor derived cell. */
export function isDerivedCellDeps(deps: unknown): deps is DerivedCellBranded {
  return (
    typeof deps === "object" &&
    deps !== null &&
    (deps as Record<PropertyKey, unknown>)[DERIVED_CELL_BRAND] === true
  );
}

/** Property key branding the COMPUTE-FN form of `derived.cell(...)` — a cell
 *  whose value is a `($) => T` derivation over its SIBLINGS, not a pre-built
 *  graph node. `Symbol.for` for the same duplicate-module reason as
 *  {@link DERIVED_CELL_BRAND}. A compute cell is always a derived cell, so it
 *  carries BOTH brands; the boot walk reads this one to know it must assemble
 *  the `$` sibling-read face and bind it before seeding. */
export const DERIVED_COMPUTE_BRAND: unique symbol = Symbol.for(
  "kolu.surface.reactor.derivedComputeCell",
);

/** One sibling's runtime access, handed to a compute cell at bind time — an
 *  engine-free bridge the boot walk builds from its OWN machinery (a cell's
 *  `store.get` / a collection's `readAll`, plus a synchronous change
 *  notification riding the post-equals write path). `reactor.ts` wraps each in
 *  an engine signal so `$.<sibling>()` becomes a tracked read; the walk never
 *  touches the engine. */
export interface SiblingSource {
  /** The sibling's CURRENT value. For an AUTHORED sibling (`engineTracked` false):
   *  a cell's post-equals value / a collection's live `readAll()` map — the value
   *  half of a mirror, whose reactive edge is the version signal below. For a
   *  DERIVED sibling (`engineTracked` true): a LIVE read of its graph node's
   *  `computed`, which the reader's own computed tracks directly. */
  read(): unknown;
  /** Subscribe to the sibling's post-equals change edge (fired synchronously,
   *  inside the writer's stack, by the bridge-owned store wrapper both cell
   *  write paths pass through — and by the wrapped collection publishers).
   *  Returns an unsubscribe fn the compute cell runs on dispose. UNUSED for an
   *  `engineTracked` source (the engine tracks its computed directly). */
  subscribe(onChange: () => void): () => void;
  /** True iff `read()` is an engine-tracked read of a DERIVED member's `computed`.
   *  The `$` face then reads it DIRECTLY (no version signal, no `subscribe`), so a
   *  derived-reads-derived chain is a pure computed graph — glitch-free by the
   *  engine's lazy pull, per the bridge law. An authored mirror leaves this false
   *  and rides the version-signal bridge. Only `reactor.ts` sets it true. */
  readonly engineTracked?: boolean;
}

/** The `$` sibling-read face as RUNTIME sources — one {@link SiblingSource} per
 *  cell/collection key, keyed by member name. The typed `SiblingRead<S>` (in
 *  `define.ts`) is its compile-time face at the `derived.cell(($) => …)` call. */
export type SiblingSourcesRuntime = Record<string, SiblingSource>;

/** Structural shape a compute-fn `derived.cell(($) => …)` dep carries beyond
 *  {@link DerivedCellBranded}: the boot walk calls `bindSiblings($)` ONCE, after
 *  every sibling mirror exists, to build the compute node — which the private
 *  serving store then eager-pulls to seed (a throw at that pull is a boot crash,
 *  never a fabricated default). */
export interface DerivedComputeCellBranded extends DerivedCellBranded {
  readonly [DERIVED_COMPUTE_BRAND]: true;
  bindSiblings(sources: SiblingSourcesRuntime): void;
}

/** Whether a cell dep is the COMPUTE-FN form of a derived cell (so the walk must
 *  bind its `$` before seeding). */
export function isDerivedComputeCellDeps(
  deps: unknown,
): deps is DerivedComputeCellBranded {
  return (
    isDerivedCellDeps(deps) &&
    (deps as unknown as Record<PropertyKey, unknown>)[DERIVED_COMPUTE_BRAND] ===
      true
  );
}

/** Property key branding a `derived.cell(source({ read, install }))` — a derived
 *  cell backed by a POLL source, whose graph node has NO synchronous seed value:
 *  the T+0 read is async, so the node's level is `undefined` until the first read
 *  lands (published through the async `connect`). The boot walk reads this brand
 *  to seed the private serving store from the member's SPEC DEFAULT (the value the
 *  hand-rolled sampler served pre-first-sample — behavior-neutral) rather than an
 *  eager `store.get()` pull that would seed `undefined` and break serialization
 *  before the first read. `Symbol.for` for the same duplicate-module reason as
 *  {@link DERIVED_CELL_BRAND}. A poll cell is always a derived cell, so it carries
 *  BOTH brands; it is NOT a compute cell (no `$` bind). */
export const DERIVED_POLL_BRAND: unique symbol = Symbol.for(
  "kolu.surface.reactor.derivedPollCell",
);

/** Whether a cell dep is a POLL-source derived cell (so the walk seeds its store
 *  from the spec default — the node has no synchronous seed until the first read). */
export function isDerivedPollCellDeps(deps: unknown): boolean {
  return (
    isDerivedCellDeps(deps) &&
    (deps as unknown as Record<PropertyKey, unknown>)[DERIVED_POLL_BRAND] ===
      true
  );
}

/** Property key branding a `derived.collection(node)` dep — a COLLECTION whose
 *  per-key contents are a projection of a graph node's keyed value (a poll source
 *  reading a whole `Map`, or a `$`-compute producing one). The graph is its one
 *  writer: the boot walk narrows the ctx `upsert`/`remove` to throw, seeds the
 *  wire snapshot from the node's current map, and fires {@link
 *  DerivedCollectionBranded.connect} — which subscribes the node and RECONCILES
 *  each new map against the last by the collection's `equals`, driving the
 *  surface's own per-key `upsert`/`remove` publishers for exactly the changed and
 *  removed keys (the keyed-reconciler wire adapter). `Symbol.for` for the same
 *  duplicate-module reason as {@link DERIVED_CELL_BRAND}. */
export const DERIVED_COLLECTION_BRAND: unique symbol = Symbol.for(
  "kolu.surface.reactor.derivedCollection",
);

/** Structural shape a `derived.collection(...)` dep carries so the boot walk can
 *  wire it without importing `reactor.ts`. */
export interface DerivedCollectionBranded {
  readonly [DERIVED_COLLECTION_BRAND]: true;
  /** The current reconciled map — the wire snapshot a late subscriber reads. For
   *  a poll node this is empty until the first read publishes; the materialized
   *  map the reconciler maintains, never a fresh recompute. */
  readAll(): Map<unknown, unknown>;
  /** One key's current value (or `undefined`) — the per-key `get` snapshot. */
  readOne(key: unknown): unknown;
  /** The connect seam: subscribe the backing node and reconcile each new map
   *  against the last by `equals`, driving the surface's per-key publishers. The
   *  walk fires it (a poll node connects async, so it may return a
   *  `Promise<Disposer>`); the returned disposer joins the runtime's ownership. */
  connect(publishers: {
    upsert(key: unknown, value: unknown): void;
    remove(key: unknown): void;
    equals(a: unknown, b: unknown): boolean;
  }): (() => void) | Promise<() => void>;
  /** Tear down the backing node + the reconcile subscription. Idempotent. */
  dispose(): void;
}

/** Whether a collection dep is a reactor `derived.collection`. */
export function isDerivedCollectionDeps(
  deps: unknown,
): deps is DerivedCollectionBranded {
  return (
    typeof deps === "object" &&
    deps !== null &&
    (deps as Record<PropertyKey, unknown>)[DERIVED_COLLECTION_BRAND] === true
  );
}
