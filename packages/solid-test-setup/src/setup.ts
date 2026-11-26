/**
 * The vitest setup file every Solid DOM test project loads
 * (`setupFiles: ["@kolu/solid-test-setup/setup"]`).
 *
 * Two facts, both loud:
 *
 *   1. **The tests run on Solid's DEVELOPMENT build.** `OBSERVE` is exported
 *      only by `solid-js`'s dev and observe builds (`types/index.d.ts`:
 *      `OBSERVE: Observe | undefined`); `@solidjs/vite-plugin` resolves the
 *      `development` condition under vitest. If a config ever resolves the
 *      production build, this throws at load instead of every diagnostic below
 *      going silent.
 *   2. **Any Solid dev diagnostic fails the test that raised it.** Every event
 *      on `OBSERVE.diagnostics` (`@solidjs/signals` 2.0.4
 *      `dist/types/core/dev.d.ts`, `Diagnostics.subscribe`) — a strict read,
 *      a write in an owned scope, a cleanup in a forbidden scope, any code —
 *      is collected, and the test's `afterEach` throws with all of them. The
 *      check names no codes, so a new one is covered the day Solid adds it.
 *   3. **The attribution tier is switched on too, once per test.** 19 of
 *      Solid's codes — the feedback family, `EFFECT_WRITES_OWN_SOURCE` among
 *      them — are raised by the attribution ENGINE, which the plain
 *      development build leaves uninstalled: without `attribution.enable()`
 *      those codes cannot fire at all, whatever the test does. A dev server
 *      installs it through `@solidjs/web`'s performance tracks
 *      (`enablePerformanceTracks` → `attribution.enable()`), and
 *      `@solidjs/vite-plugin` injects that only for `vite serve` — so under
 *      vitest the engine is this file's to hold open.
 *
 *      TWO HOLDS, both of them this file's. One is taken at LOAD and never
 *      released, so the engine is installed while the test file's own
 *      modules evaluate — kolu has module-scope owned scopes that compute at
 *      import, and a diagnostic they raise is judged only if the engine was
 *      on before they ran. The other is taken in `beforeEach` and released
 *      in `afterEach`, because several findings remember what they have
 *      already said and only `enable()` (or the last release) forgets it:
 *      `IMMUTABLE_UPDATE_IN_STORE` is once per store path
 *      (`@solidjs/signals` 2.0.4 `dev.attribution.js:1348,1385`), so without
 *      the per-test hold the second test in a file to write that path the
 *      wrong way would pass. Stacking works because `enable()` resets that
 *      memory on EVERY hold while the engine stays installed until the last
 *      one is released (`dev.attribution.js:3232-3237,3126`).
 *
 *      WHICH CODES THE LANE GATES ON is `SOLID_ATTRIBUTION_OPTIONS`
 *      (`./attribution`), shared with the `solid-dev` build so both judge the
 *      same set: the runtime's own codes, plus eight of the engine's —
 *      `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`,
 *      `IMMUTABLE_UPDATE_IN_STORE`, `UNSTABLE_LIST_IDENTITY`,
 *      `FALLBACK_FLASH`, `OPTIMISTIC_REVERTED`, `GRAPH_GROWTH` and
 *      `ABANDONED_FLIGHTS`. Off are the six checks `checks: false` folds away
 *      (`HOT_SCOPE_RERUNS` and `HOT_SCOPE_FANOUT` from `hotRuns`,
 *      `HOT_SCOPE_TIME`, `WASTED_RECOMPUTE`, `WIDE_SCOPE_DEPS`,
 *      `UNSTABLE_MEMO_OUTPUT`, and the engine's lower `HUGE_FAN_OUT`
 *      threshold) and the five that time a real
 *      wait: `SILENT_HOLD` and `UNTRACKED_ASYNC_HANDLER` (both guarded by
 *      `holds`, `dev.attribution.js:1725,2800-2802`), `LONG_HOLD`,
 *      `ASYNC_WATERFALL` and `STACKED_HOLDS` — a test that waits on a real
 *      timer would fail for its fixture's delay. The engine's diagnostics
 *      reach the collector below unchanged: it emits on the SAME
 *      `OBSERVE.diagnostics` channel.
 */

import { type DiagnosticEvent, OBSERVE } from "solid-js";
import { attribution } from "solid-js/attribution";
import { afterAll, afterEach, beforeEach } from "vitest";
import { SOLID_ATTRIBUTION_OPTIONS } from "./attribution.ts";

if (OBSERVE === undefined) {
  throw new Error(
    "@kolu/solid-test-setup: solid-js resolved to its PRODUCTION build (OBSERVE is undefined). " +
      "Solid tests must run on the development build, where its diagnostics exist — " +
      "load @solidjs/vite-plugin in this vitest config and give the project a DOM environment.",
  );
}

/** One diagnostic, with the stack at the moment Solid raised it: `ownerPath`
 *  names the owner, the stack names the line in the code under test. */
type Raised = { event: DiagnosticEvent; stack: string };

let raised: Raised[] = [];

// SUBSCRIBED BEFORE THE ENGINE IS ENABLED, and before the test file itself is
// evaluated: vitest runs this setup file first, so a diagnostic raised while
// the test file's own modules load — kolu has module-scope owned scopes that
// compute at import — lands in this array like any other.
OBSERVE.diagnostics.subscribe((event) => {
  raised.push({ event, stack: new Error().stack ?? "" });
});

// THE WORKER-LONG HOLD, taken at load so the engine is already installed
// while the test file's modules evaluate. Never released: the file's last
// `afterEach` must not uninstall the engine, and the worker exits with it.
attribution.enable(SOLID_ATTRIBUTION_OPTIONS);

// THE PER-TEST HOLD, stacked on top of the worker-long one. It is what makes
// every finding that remembers what it has already said start each test
// having said nothing: `enable()` calls `resetWindows()` on EVERY hold
// (`@solidjs/signals` 2.0.4 `dev.attribution.js:3232-3237`), which clears
// `immutableReported` and the rest (`:3126`), while the engine itself stays
// installed until the last hold is released. Both holds pass the same
// options, so the merge of the two is that same set.
let release: (() => void) | undefined;

beforeEach(() => {
  release = attribution.enable(SOLID_ATTRIBUTION_OPTIONS);
});

/**
 * The diagnostics raised so far, TAKEN off the collector so the `afterEach`
 * below no longer has them to throw with: the seam for a test whose subject
 * is a diagnostic — this package's own tests, which provoke one on purpose
 * and judge it themselves, at module scope included. Nothing else should call
 * it. A diagnostic a test did not mean to raise must fail that test, which is
 * the whole point of this file.
 */
export function takeSolidDiagnostics(): DiagnosticEvent[] {
  const events = raised.map(({ event }) => event);
  raised = [];
  return events;
}

function report(events: Raised[], when: string): never {
  throw new Error(
    `Solid raised ${events.length} dev diagnostic(s) ${when}:\n` +
      events
        .map(
          ({ event, stack }) =>
            `  [${event.code}] ${event.message}` +
            (event.ownerPath ? `\n    at ${event.ownerPath.join(" › ")}` : "") +
            (event.loc ? `\n    (${event.loc})` : "") +
            `\n    raised from:\n${stack.split("\n").slice(1).join("\n")}`,
        )
        .join("\n"),
  );
}

afterEach(() => {
  release?.();
  release = undefined;
  if (raised.length === 0) return;
  const events = raised;
  raised = [];
  // Load-time findings are still sitting here when the FIRST test ends, so
  // they fail that test; the wording covers both.
  report(events, "during this test (or while this file's modules loaded)");
});

// A file whose modules raise a diagnostic and then run no test at all — or
// one raised after the last `afterEach` — has nothing else to fail.
afterAll(() => {
  if (raised.length === 0) return;
  const events = raised;
  raised = [];
  report(events, "in this file outside any test");
});
