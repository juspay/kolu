# @kolu/solid-test-setup

The vitest setup file for every Solid DOM test project in this repository. It
makes three facts loud:

- **The tests run on Solid's development build.** It throws at load if
  `OBSERVE` from `solid-js` is undefined, which is what the production build
  answers.
- **A Solid dev diagnostic fails the test that raised it, with one named
  exception.** It subscribes to `OBSERVE.diagnostics` and throws from
  `afterEach` with every event the test produced — strict reads, writes in
  owned scopes, cleanups in forbidden scopes, any code — at any severity, and
  at none. The single exception is `EFFECT_RELAY_TEAR` graded `info`, a DOM
  measurement's relay tear, which has no repair: it is printed as advisory and
  fails nothing. `info` is not a blanket pass — `EFFECT_WRITES_OWN_SOURCE` is
  `info` for a two-effect cycle, `FALLBACK_FLASH` and `OPTIMISTIC_REVERTED`
  always are, and all three fail here.
- **The attribution engine is held for the whole worker, and again for each
  test.** The 19 codes it raises are off until something calls
  `attribution.enable()`, so the worker-long hold is taken at load — before
  the test file's own modules evaluate, which is where kolu's module-scope
  owned scopes compute. The per-test hold in `beforeEach` stacks on top of it:
  `enable()` resets the engine's windows on EVERY hold, so a finding that
  reports a subject once (`IMMUTABLE_UPDATE_IN_STORE`, once per store path)
  starts each test having said nothing, while the engine itself stays
  installed between tests.

```ts
// vitest.config.ts, in the DOM project
import { SOLID_INLINE_DEPS } from "@kolu/solid-test-setup/vitest";

test: {
  environment: "happy-dom",
  setupFiles: ["@kolu/solid-test-setup/setup"],
  server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
}
```

It has three entries:

- `./setup` (`src/setup.ts`): the setup file above. It also exports
  `takeSolidDiagnostics()`, which takes the raised diagnostics off the
  collector so `afterEach` no longer throws with them — the seam for this
  package's own tests, which provoke a diagnostic on purpose, and for nothing
  else.
- `./vitest` (`src/vitest.ts`): `SOLID_INLINE_DEPS`, the specifiers Solid
  ships itself under, which every DOM project must inline so the test and
  Solid share one reactive core; and `SOLID_INLINE_DEPS_SCHEDULED`, the same
  list plus `@solid-primitives/scheduled`.
- `./attribution` (`src/attribution.ts`): `SOLID_ATTRIBUTION_OPTIONS`, the one
  set of attribution options every kolu lane judges by — shared with the
  client's `solid-dev` build (`packages/client/src/solidDiagnosticsExpose.ts`),
  so a finding is never red here and silent in the browser. Judged: the
  runtime's own always-on codes, plus ten of the engine's —
  `EFFECT_WRITES_OWN_SOURCE`, `EFFECT_RELAY_TEAR`,
  `IMMUTABLE_UPDATE_IN_STORE`, `UNSTABLE_LIST_IDENTITY`, `FALLBACK_FLASH`,
  `OPTIMISTIC_REVERTED`, `GRAPH_GROWTH`, `ABANDONED_FLIGHTS`,
  `WIDE_SCOPE_DEPS` and `UNSTABLE_MEMO_OUTPUT` — and `HUGE_FAN_OUT` at the
  engine's lower 250-subscriber threshold. Off are the nine the clock
  decides: `HOT_SCOPE_RERUNS`, `HOT_SCOPE_FANOUT`, `HOT_SCOPE_TIME`,
  `WASTED_RECOMPUTE`, `SILENT_HOLD`, `UNTRACKED_ASYNC_HANDLER`, `LONG_HOLD`,
  `ASYNC_WATERFALL` and `STACKED_HOLDS`.

It is a dev dependency of every package with Solid DOM tests.

The running app gets the same check from the e2e lane `ci::e2e-solid-dev`
(see `packages/tests/support/solidDevBuild.ts`).

## What not to break

- Never widen the advisory list by hand, and never filter on severity alone.
  Exactly one code is advisory (`EFFECT_RELAY_TEAR` at `info`); a second one is
  a decision that belongs in `isAdvisorySolidDiagnostic`, written down with the
  reason that code has no repair. A diagnostic that should not fail a test is
  otherwise a defect in the code that raised it.
- Load it only in DOM projects. A Node project gets Solid's server build, where
  `OBSERVE` is undefined, and this file would rightly refuse it.
