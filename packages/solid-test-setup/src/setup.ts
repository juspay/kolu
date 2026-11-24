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
 *      on `OBSERVE.diagnostics` (`@solidjs/signals` 2.0.3
 *      `dist/types/core/dev.d.ts`, `Diagnostics.subscribe`) — a strict read,
 *      a write in an owned scope, a cleanup in a forbidden scope, any code —
 *      is collected, and the test's `afterEach` throws with all of them. The
 *      check names no codes, so a new one is covered the day Solid adds it.
 */

import { type DiagnosticEvent, OBSERVE } from "solid-js";
import { afterEach } from "vitest";

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
