/**
 * THE ONE JUDGED SET: the options every kolu lane installs Solid's attribution
 * engine with.
 *
 * `attribution.enable()` is what turns the engine's 19 codes on at all, and
 * each lane has its own caller — `@kolu/solid-test-setup/setup` under vitest,
 * `packages/client/src/solidDiagnosticsExpose.ts` in the `solid-dev` build
 * that `ci::e2e-solid-dev` serves. They must judge the SAME set, or a finding
 * is a red unit test on one machine and a silent pass in the browser, so the
 * options live here rather than in each caller.
 *
 * WHAT IS FOLDED OFF, AND WHY ONLY THESE. Two kinds of check judge something
 * other than the code:
 *
 *   - `checks: false` folds off the six cost checks (`hotRuns`, `hotTime`,
 *     `wideDeps`, `unstableMemos`, `fanOut`, `wastedRecompute` →
 *     `HOT_SCOPE_RERUNS`, `HOT_SCOPE_TIME`, `WIDE_SCOPE_DEPS`,
 *     `UNSTABLE_MEMO_OUTPUT`, `HOT_SCOPE_FANOUT`, `WASTED_RECOMPUTE`), whose
 *     budgets are milliseconds of compute on whatever machine is running.
 *   - The six wall-clock checks below are not cost checks, so `checks: false`
 *     leaves them on: `holds` (`SILENT_HOLD`, ≥100ms), `longHolds`
 *     (`LONG_HOLD`), `waterfalls` (`ASYNC_WATERFALL`, ≥50ms a flight),
 *     `graphGrowth` (`GRAPH_GROWTH`), `abandonedFlights`
 *     (`ABANDONED_FLIGHTS`) and `stackedHolds` (`STACKED_HOLDS`). Every one
 *     of them times a REAL WAIT — a daemon answering, a fixture's timer, a
 *     loaded CI box — so they would fail an e2e scenario or a test for the
 *     latency of the machine it ran on, not for anything in the code.
 *
 * WHAT STAYS ON is everything a diff can cause: the runtime's own 56 codes
 * (which this object cannot touch) plus the engine's feedback family —
 * `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`, `IMMUTABLE_UPDATE_IN_STORE`,
 * `UNSTABLE_LIST_IDENTITY`, `UNTRACKED_ASYNC_HANDLER`, `FALLBACK_FLASH` and
 * `OPTIMISTIC_REVERTED`. `fallbackFlashes` is left at its default on purpose:
 * its 150ms window judges a fallback that was shown and taken away, which is a
 * boundary's shape rather than the machine's speed, and it found eight real
 * sites in this repository.
 *
 * `log: false` turns off the per-re-run console print only. Every finding
 * still reaches `OBSERVE.diagnostics`, which is what both lanes read.
 *
 * This module imports nothing but a type: the client's copy of it is evaluated
 * before any app module, so it must stay that way.
 */

import type { AttributionOptions } from "solid-js/attribution";

export const SOLID_ATTRIBUTION_OPTIONS = {
  log: false,
  checks: false,
  holds: false,
  longHolds: false,
  waterfalls: false,
  graphGrowth: false,
  abandonedFlights: false,
  stackedHolds: false,
} as const satisfies AttributionOptions;
