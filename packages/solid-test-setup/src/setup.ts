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
 *   3. **The attribution tier is switched on too.** 19 of Solid's codes — the
 *      feedback family, `EFFECT_WRITES_OWN_SOURCE` among them — are raised by
 *      the attribution ENGINE, which the plain development build leaves
 *      uninstalled: without `attribution.enable()` those codes cannot fire at
 *      all, whatever the test does. A dev server installs it through
 *      `@solidjs/web`'s performance tracks
 *      (`enablePerformanceTracks` → `attribution.enable({ log: false,
 *      checks: false })`), and `@solidjs/vite-plugin` injects that only for
 *      `vite serve` — so under vitest the engine is this file's to hold open.
 *      Enabled with the dev server's OWN options, and for the whole worker:
 *      no per-run console log, and the six cost checks (`hotRuns`, `hotTime`,
 *      `wideDeps`, `unstableMemos`, `fanOut`, `wastedRecompute`) off, since
 *      their thresholds judge a running app's timings and would fail tests on
 *      the machine's speed. The feedback checks — own-source writes, relay
 *      tears, cycles — are not cost checks and stay on. Its diagnostics reach
 *      the collector below unchanged: the engine emits on the SAME
 *      `OBSERVE.diagnostics` channel.
 */

import { type DiagnosticEvent, OBSERVE } from "solid-js";
import { attribution } from "solid-js/attribution";
import { afterEach } from "vitest";

if (OBSERVE === undefined) {
  throw new Error(
    "@kolu/solid-test-setup: solid-js resolved to its PRODUCTION build (OBSERVE is undefined). " +
      "Solid tests must run on the development build, where its diagnostics exist — " +
      "load @solidjs/vite-plugin in this vitest config and give the project a DOM environment.",
  );
}

// Held for the lifetime of the test worker — every test in the file gets the
// attribution tier, and nothing has to remember to enable it. The release
// handle is deliberately dropped: the worker exits with the engine installed.
attribution.enable({ log: false, checks: false });

/** One diagnostic, with the stack at the moment Solid raised it: `ownerPath`
 *  names the owner, the stack names the line in the code under test. */
type Raised = { event: DiagnosticEvent; stack: string };

let raised: Raised[] = [];
OBSERVE.diagnostics.subscribe((event) => {
  raised.push({ event, stack: new Error().stack ?? "" });
});

afterEach(() => {
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
