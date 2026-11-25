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
 *      The hold is taken in `beforeEach` and released in `afterEach`, NOT
 *      held for the worker: several findings remember what they have already
 *      said, and only `enable()` (or the last release) forgets it.
 *      `IMMUTABLE_UPDATE_IN_STORE` is once per store path
 *      (`@solidjs/signals` 2.0.4 `dev.attribution.js:1348,1385`), so with a
 *      worker-long hold the second test in a file to write that path the
 *      wrong way would pass.
 *
 *      WHICH CODES THE LANE GATES ON is `SOLID_ATTRIBUTION_OPTIONS`
 *      (`./attribution`), shared with the `solid-dev` build so both judge the
 *      same set: the runtime's own 56 codes, plus the engine's
 *      `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`,
 *      `IMMUTABLE_UPDATE_IN_STORE`, `UNSTABLE_LIST_IDENTITY`,
 *      `UNTRACKED_ASYNC_HANDLER`, `FALLBACK_FLASH` and `OPTIMISTIC_REVERTED`.
 *      Off are the six cost checks (`HOT_SCOPE_RERUNS`, `HOT_SCOPE_TIME`,
 *      `WIDE_SCOPE_DEPS`, `UNSTABLE_MEMO_OUTPUT`, `HOT_SCOPE_FANOUT`,
 *      `WASTED_RECOMPUTE`) and the six wall-clock ones (`SILENT_HOLD`,
 *      `LONG_HOLD`, `ASYNC_WATERFALL`, `GRAPH_GROWTH`, `ABANDONED_FLIGHTS`,
 *      `STACKED_HOLDS`), which judge the machine's timings rather than the
 *      code — a test that waits on a real timer would fail for its fixture's
 *      delay. The engine's diagnostics reach the collector below unchanged:
 *      it emits on the SAME `OBSERVE.diagnostics` channel.
 */

import { type DiagnosticEvent, OBSERVE } from "solid-js";
import { attribution } from "solid-js/attribution";
import { afterEach, beforeEach } from "vitest";
import { SOLID_ATTRIBUTION_OPTIONS } from "./attribution.ts";

if (OBSERVE === undefined) {
  throw new Error(
    "@kolu/solid-test-setup: solid-js resolved to its PRODUCTION build (OBSERVE is undefined). " +
      "Solid tests must run on the development build, where its diagnostics exist — " +
      "load @solidjs/vite-plugin in this vitest config and give the project a DOM environment.",
  );
}

// One hold per test, so every finding that remembers what it has already said
// starts the test having said nothing (`enable()` resets that memory, and so
// does the last release).
let release: (() => void) | undefined;

beforeEach(() => {
  release = attribution.enable(SOLID_ATTRIBUTION_OPTIONS);
});

/** One diagnostic, with the stack at the moment Solid raised it: `ownerPath`
 *  names the owner, the stack names the line in the code under test. */
type Raised = { event: DiagnosticEvent; stack: string };

let raised: Raised[] = [];
OBSERVE.diagnostics.subscribe((event) => {
  raised.push({ event, stack: new Error().stack ?? "" });
});

/**
 * The diagnostics raised so far, TAKEN off the collector so the `afterEach`
 * below no longer has them to throw with: the seam for a test whose subject
 * is a diagnostic — this package's own tests, which provoke one on purpose
 * and judge it themselves. Nothing else should call it. A diagnostic a test
 * did not mean to raise must fail that test, which is the whole point of this
 * file.
 */
export function takeSolidDiagnostics(): DiagnosticEvent[] {
  const events = raised.map(({ event }) => event);
  raised = [];
  return events;
}

afterEach(() => {
  release?.();
  release = undefined;
  if (raised.length === 0) return;
  const events = raised;
  raised = [];
  throw new Error(
    `Solid raised ${events.length} dev diagnostic(s) during this test:\n` +
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
});
