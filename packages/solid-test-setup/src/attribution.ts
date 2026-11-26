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
 * WHAT IS FOLDED OFF, AND WHY ONLY THESE. Every check named off here judges
 * the CLOCK of the machine that ran it; every check left on judges the code.
 *
 *   - The three that read the clock as a cost are named one by one, because
 *     `checks: false` would take six at once (`resolveHold`,
 *     `dev.attribution.js:3163-3170`) and each key is independent
 *     (`types/core/attribution.d.ts:413-483`). `hotRuns: false` (120 runs in
 *     1000ms) kills TWO codes, `HOT_SCOPE_RERUNS` and `HOT_SCOPE_FANOUT`,
 *     which is emitted from the same window (`:568,631`). `hotTime: false`
 *     is `HOT_SCOPE_TIME` (8ms of self-time in 1000ms) and
 *     `wastedRecompute: false` is `WASTED_RECOMPUTE` (5 runs, 80% unchanged,
 *     2ms of compute).
 *   - `holds: false` turns off TWO codes, not one: `SILENT_HOLD` (a write
 *     held ≥100ms, `dev.attribution.js:1725`) and `UNTRACKED_ASYNC_HANDLER`,
 *     whose guard is `options.holds` as well (`:2800-2802`) and whose
 *     thresholds are the hold thresholds. The other three are `longHolds`
 *     (`LONG_HOLD`), `waterfalls` (`ASYNC_WATERFALL`, ≥50ms a flight) and
 *     `stackedHolds` (`STACKED_HOLDS`). Every one of those five times a REAL
 *     WAIT — a daemon answering, a fixture's timer, a loaded CI box — so they
 *     would fail an e2e scenario or a test for the latency of the machine it
 *     ran on, not for anything in the code.
 *
 * THE THREE COUNT CHECKS STAY ON, which is why `checks: false` is not used:
 * `wideDeps` is a dependency COUNT (200 sources on one scope), `unstableMemos`
 * a number of CONSECUTIVE equal-but-new memo outputs (four) and `fanOut` a
 * subscriber COUNT (250), gating the RUNTIME's `HUGE_FAN_OUT` at a threshold
 * below the core's always-on 2000 (`:430-439`). None of them reads a clock, so
 * each fires on the graph a diff built and not on how fast the box ran it.
 * `UNSTABLE_MEMO_OUTPUT` in particular names the memo whose equality gate
 * never closes — the class this migration kept hitting by hand.
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
 * WHAT STAYS ON is everything a diff can cause: the runtime's own codes (of
 * which `fanOut` lowers one threshold, `HUGE_FAN_OUT`, to 250 subscribers)
 * plus TEN of the engine's nineteen — `EFFECT_WRITES_OWN_SOURCE`,
 * `EFFECT_RELAY_TEAR`, `IMMUTABLE_UPDATE_IN_STORE`, `UNSTABLE_LIST_IDENTITY`,
 * `FALLBACK_FLASH`, `OPTIMISTIC_REVERTED`, `GRAPH_GROWTH`,
 * `ABANDONED_FLIGHTS`, `WIDE_SCOPE_DEPS` and `UNSTABLE_MEMO_OUTPUT`. Off are
 * the other nine: `HOT_SCOPE_RERUNS`, `HOT_SCOPE_FANOUT`, `HOT_SCOPE_TIME`,
 * `WASTED_RECOMPUTE`, `SILENT_HOLD`, `UNTRACKED_ASYNC_HANDLER`, `LONG_HOLD`,
 * `ASYNC_WATERFALL` and `STACKED_HOLDS`. `fallbackFlashes` is left at its
 * default on purpose: its 150ms window judges a fallback that was shown and
 * taken away, which is a boundary's shape rather than the machine's speed, and
 * it found eight real sites in this repository. DECIDED: it therefore fails
 * both judges — `FALLBACK_FLASH` is always graded `info`, and `info` is
 * advisory only for `EFFECT_RELAY_TEAR`, so a flash fails the unit lane's
 * `afterEach` and the `solid-dev` e2e lane alike. That is intended: a flashed
 * fallback is a defect to fix, not a note to print.
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
  hotRuns: false,
  hotTime: false,
  wastedRecompute: false,
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
