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
 *   - The five wall-clock checks below are not cost checks, so `checks: false`
 *     leaves them on and each is named off here. `holds: false` turns off TWO
 *     codes, not one: `SILENT_HOLD` (a write held ≥100ms,
 *     `dev.attribution.js:1725`) and `UNTRACKED_ASYNC_HANDLER`, whose guard
 *     is `options.holds` as well (`:2800-2802`) and whose thresholds are the
 *     hold thresholds. The other three are `longHolds` (`LONG_HOLD`),
 *     `waterfalls` (`ASYNC_WATERFALL`, ≥50ms a flight) and `stackedHolds`
 *     (`STACKED_HOLDS`). Every one of those five times a REAL WAIT — a daemon
 *     answering, a fixture's timer, a loaded CI box — so they would fail an
 *     e2e scenario or a test for the latency of the machine it ran on, not
 *     for anything in the code.
 *
 * `graphGrowth` and `abandonedFlights` are LEFT AT THEIR DEFAULTS, on. Neither
 * times a wait. `GRAPH_GROWTH` compares owner, computation, signal and edge
 * counts over three consecutive visits to the same ROUTE and fires only when
 * every series climbs to 1.25× (`:2165-2240`); kolu has no router and no
 * `withOrigin`, so no navigation ever carries a route and the check is inert.
 * `ABANDONED_FLIGHTS` fires when ONE async source supersedes three flights
 * inside 1000ms (`:2256-2290`) — the request-per-keystroke shape, which a
 * fast machine makes more likely, not less: it judges the code, not the clock.
 *
 * WHAT STAYS ON is everything a diff can cause: the runtime's own 56 codes
 * (which this object cannot touch) plus eight of the engine's —
 * `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`, `IMMUTABLE_UPDATE_IN_STORE`,
 * `UNSTABLE_LIST_IDENTITY`, `FALLBACK_FLASH`, `OPTIMISTIC_REVERTED`,
 * `GRAPH_GROWTH` and `ABANDONED_FLIGHTS`. `fallbackFlashes` is left at its
 * default on purpose: its 150ms window judges a fallback that was shown and
 * taken away, which is a boundary's shape rather than the machine's speed, and
 * it found eight real sites in this repository.
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
  // KEEP THIS KEY. `stackedHolds` is redundant under `holds: false`, but it is
  // the string `default.nix`'s `mkClientDist` greps the shipped dist for to
  // prove this `enable()` call was dropped from the production build
  // (minification cannot rename a key handed to another package). Tidying it
  // away would make that check vacuous.
  stackedHolds: false,
} as const satisfies AttributionOptions;
