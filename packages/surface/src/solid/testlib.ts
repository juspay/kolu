/**
 * What ANOTHER package's suite needs to drive a `.use()` view: the hand-driven
 * source, the deltas harness built on it, and its `settle`.
 *
 * These were in-package helpers (`controllableStream.testlib.ts`,
 * `deltasHarness.testlib.ts`) for the four suites here that watch one
 * collection's `deltas` stream. A consumer's suite needs exactly the same
 * three moves — a reactive root, a hand-pushed source, and the macrotask turns
 * that let a pushed frame cross the stream fiber and land in the store — and
 * the kolu client had written them out by hand, citing this directory while
 * doing so (`palette/fleetStanding.test.ts`). That copy is the one that keeps
 * testing the old timing after a flake is fixed here, so the door is opened
 * instead.
 *
 * Kept off the main door (`@kolu/surface/solid`) so no product's runtime
 * imports a test helper.
 */

export {
  type ControllableStream,
  controllableStream,
} from "./controllableStream.testlib";
export {
  type DeltasHarness,
  driveDeltas,
  type NumberRow,
  numberRows,
  settle,
} from "./deltasHarness.testlib";
