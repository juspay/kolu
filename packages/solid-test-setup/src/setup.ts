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
 *   2. **Solid's grade and the code together decide what fails.** Every event
 *      on `OBSERVE.diagnostics` (`@solidjs/signals` 2.0.4
 *      `dist/types/core/dev.d.ts`, `Diagnostics.subscribe`) — a strict read,
 *      a write in an owned scope, a cleanup in a forbidden scope, any code —
 *      is collected, and the test's `afterEach` throws with every one that is
 *      not advisory. EXACTLY ONE finding is advisory: `EFFECT_RELAY_TEAR`
 *      graded `info`, a DOM measurement's relay tear, which has no repair. It
 *      is printed and fails nothing. Every OTHER code fails at ANY grade,
 *      `info` included — Solid grades `EFFECT_WRITES_OWN_SOURCE` `info` for a
 *      two-effect cycle and `FALLBACK_FLASH`/`OPTIMISTIC_REVERTED` `info`
 *      always, and all three are defects here — and so does an event carrying
 *      no grade at all. A second advisory code is a decision, not a default:
 *      it needs its own disposition in `isAdvisorySolidDiagnostic` below.
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
 *      same set: the runtime's own codes (with `HUGE_FAN_OUT` lowered to 250
 *      subscribers by `fanOut`), plus TEN of the engine's nineteen —
 *      `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`,
 *      `IMMUTABLE_UPDATE_IN_STORE`, `UNSTABLE_LIST_IDENTITY`,
 *      `FALLBACK_FLASH`, `OPTIMISTIC_REVERTED`, `GRAPH_GROWTH`,
 *      `ABANDONED_FLIGHTS`, `WIDE_SCOPE_DEPS` and `UNSTABLE_MEMO_OUTPUT`.
 *      Off are the nine the clock decides: `HOT_SCOPE_RERUNS` and
 *      `HOT_SCOPE_FANOUT` (both under `hotRuns: false`), `HOT_SCOPE_TIME`,
 *      `WASTED_RECOMPUTE`, and the five that time a real wait: `SILENT_HOLD`
 *      and `UNTRACKED_ASYNC_HANDLER` (both guarded by `holds`,
 *      `dev.attribution.js:1725,2800-2802`), `LONG_HOLD`, `ASYNC_WATERFALL`
 *      and `STACKED_HOLDS` — a test that waits on a real
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

/**
 * IS THIS FINDING ADVISORY? Exactly one code is: `EFFECT_RELAY_TEAR` graded
 * `info`. Solid grades every diagnostic it emits (`@solidjs/signals` 2.0.4:
 * every `emitDiagnostic` call site in `dev-shared.js`, `dev.js` and
 * `dev.attribution.js` passes a `severity`), and for THAT code `info` is its
 * own word for "reported, not wrong": the relay tear of a DOM measurement is
 * the standing example — "the tear is the cost of measuring" is Solid's own
 * repair text for it (`dev.attribution.js:1222-1229`), and corvu-next's
 * vitest setup passes on exactly that grade.
 *
 * `info` IS NOT A BLANKET PASS. Solid grades `EFFECT_WRITES_OWN_SOURCE` by
 * cycle length — `links.length === 1 ? "warn" : "info"`
 * (`dev.attribution.js:1054`) — so a cycle relayed through two effects is
 * `info` while Solid's own repair text says "derive them in memos and drop
 * the writes". `FALLBACK_FLASH` and `OPTIMISTIC_REVERTED` are always `info`.
 * Every code other than `EFFECT_RELAY_TEAR` therefore fails whatever its
 * grade, and an unknown `info` code fails until it is dispositioned.
 *
 * `error` and `warn` fail too, and so does an event carrying NO grade: a
 * shape this file does not know is a finding it must not wave through.
 *
 * This is not a softer gate. A derivable relay is `warn` from its first
 * sighting, and a repeated one escalates to `warn` at three
 * (`dev.attribution.js:1205-1217`).
 */
export function isAdvisorySolidDiagnostic(event: DiagnosticEvent): boolean {
  return event.severity === "info" && event.code === "EFFECT_RELAY_TEAR";
}

function words({ event, stack }: Raised): string {
  return (
    `  [${event.severity ?? "(no severity)"}] [${event.code}] ${event.message}` +
    (event.ownerPath ? `\n    at ${event.ownerPath.join(" › ")}` : "") +
    (event.loc ? `\n    (${event.loc})` : "") +
    `\n    raised from:\n${stack.split("\n").slice(1).join("\n")}`
  );
}

/** Print what Solid graded advisory, then throw with what it graded wrong.
 *  A run with advisory findings alone prints and returns. */
function judge(events: Raised[], when: string): void {
  const advisory = events.filter(({ event }) =>
    isAdvisorySolidDiagnostic(event),
  );
  if (advisory.length > 0)
    console.info(
      `Solid graded ${advisory.length} finding(s) info ${when} — advisory, failing nothing:\n` +
        advisory.map(words).join("\n"),
    );
  const failures = events.filter(
    ({ event }) => !isAdvisorySolidDiagnostic(event),
  );
  if (failures.length === 0) return;
  throw new Error(
    `Solid raised ${failures.length} dev diagnostic(s) ${when}:\n` +
      failures.map(words).join("\n"),
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
  judge(events, "during this test (or while this file's modules loaded)");
});

// A file whose modules raise a diagnostic and then run no test at all — or
// one raised after the last `afterEach` — has nothing else to fail.
afterAll(() => {
  if (raised.length === 0) return;
  const events = raised;
  raised = [];
  judge(events, "in this file outside any test");
});
