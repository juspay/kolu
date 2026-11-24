# @kolu/solid-test-setup

The vitest setup file for every Solid DOM test project in this repository. It
makes two facts loud:

- **The tests run on Solid's development build.** It throws at load if
  `OBSERVE` from `solid-js` is undefined, which is what the production build
  answers.
- **A Solid dev diagnostic fails the test that raised it.** It subscribes to
  `OBSERVE.diagnostics` and throws from `afterEach` with every event the test
  produced: strict reads, writes in owned scopes, cleanups in forbidden scopes,
  any code Solid emits.

```ts
// vitest.config.ts, in the DOM project
test: {
  environment: "happy-dom",
  setupFiles: ["@kolu/solid-test-setup/setup"],
}
```

The single entry is `./setup` (`src/setup.ts`). It is a dev dependency of every
package with Solid DOM tests: `kolu-client`, `@kolu/surface`,
`@kolu/surface-app`, `@kolu/surface-map`, `@kolu/solid-dockrow`,
`@kolu/solid-logtail`, `@kolu/solid-pierre` and `@kolu/xterm-kit`.

The running app gets the same check from the e2e lane `ci::e2e-solid-dev`
(see `packages/tests/support/solidDevBuild.ts`).

## What not to break

- Never filter codes or severities. A diagnostic that should not fail a test
  is a defect in the code that raised it.
- Load it only in DOM projects. A Node project gets Solid's server build, where
  `OBSERVE` is undefined, and this file would rightly refuse it.
