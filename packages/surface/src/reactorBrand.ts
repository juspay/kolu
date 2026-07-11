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
