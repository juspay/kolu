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
  /** The sibling's CURRENT value — a cell's post-equals value, a collection's
   *  live `readAll()` map. Read live inside the compute; the version signal (in
   *  `reactor.ts`) is the reactive dependency, this is the value. */
  read(): unknown;
  /** Subscribe to the sibling's post-equals change edge (fired synchronously,
   *  inside the writer's stack, by the bridge-owned store wrapper both cell
   *  write paths pass through — and by the wrapped collection publishers).
   *  Returns an unsubscribe fn the compute cell runs on dispose. */
  subscribe(onChange: () => void): () => void;
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
