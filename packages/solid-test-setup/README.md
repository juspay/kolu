# @kolu/solid-test-setup

The vitest setup file for every Solid DOM test project in this repository. It
makes three facts loud:

- **The tests run on Solid's development build.** It throws at load if
  `OBSERVE` from `solid-js` is undefined, which is what the production build
  answers.
- **A Solid dev diagnostic fails the test that raised it.** It subscribes to
  `OBSERVE.diagnostics` and throws from `afterEach` with every event the test
  produced: strict reads, writes in owned scopes, cleanups in forbidden scopes,
  any code Solid emits.
- **The attribution engine is held for each test**, in `beforeEach`, and
  released in `afterEach` — the 19 codes it raises are off until something
  calls `attribution.enable()`, and a finding that reports a subject once
  (`IMMUTABLE_UPDATE_IN_STORE`, once per store path) forgets what it has said
  only when the engine is enabled afresh. A worker-long hold would let the
  second test in a file write a path the wrong way in silence.

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
  so a finding is never red here and silent in the browser. It folds off the
  cost checks and the six wall-clock ones, which judge the machine's timings.

It is a dev dependency of every package with Solid DOM tests.

The running app gets the same check from the e2e lane `ci::e2e-solid-dev`
(see `packages/tests/support/solidDevBuild.ts`).

## What not to break

- Never filter codes or severities. A diagnostic that should not fail a test
  is a defect in the code that raised it.
- Load it only in DOM projects. A Node project gets Solid's server build, where
  `OBSERVE` is undefined, and this file would rightly refuse it.
