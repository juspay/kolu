import { SOLID_INLINE_DEPS_SCHEDULED } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// The tests that RUN Solid live with the Solid client layer, under `src/solid/`:
// a test that drives the client or renders belongs there, and joins the DOM
// project by existing. Every other test runs in the Node project.
const DOM_TESTS = ["src/solid/**/*.test.{ts,tsx}"];

// The bench project resolves Solid's PRODUCTION tier, which is what ships.
// `solid({ dev: false })` alone does not get there under vitest: the plugin's
// `forceProduction` is gated on `!isTestMode`
// (`@solidjs/vite-plugin/dist/esm/index.mjs:4511`), so the `development|production`
// placeholder Vite carries in its default conditions would still resolve to
// `development` (vite `dist/node/chunks/node.js:29556`, since a test run is not
// `isProduction`). Naming the conditions ourselves removes the placeholder: the
// plugin only fills conditions in when they are `null` (`:4618-4620`) and
// otherwise appends ours verbatim (`:4628`).
const PROD_CLIENT_CONDITIONS = ["module", "browser", "production"];
const PROD_SERVER_CONDITIONS = ["module", "node", "production"];

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness (`SurfaceGate`)
  // compiles its JSX to real DOM. Harmless for the `.test.ts` files (no JSX).
  //
  // The plugin picks each project's posture from its environment: the `dom`
  // project gets browser export conditions and Solid's DEVELOPMENT builds (real
  // `createEffect`, `isServer === false` — which `@solid-primitives/scheduled`'s
  // `debounce` needs, since it no-ops on the server, for the `useCellLocal`
  // coalesce test); the `node` project gets the server posture, which none of
  // its tests reach Solid through.
  plugins: [solid()],
  test: {
    // Scrub the production daemon-locator env in every worker so a test can
    // never reach a live daemon (#1334 adversary path). See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
    // Two test projects, both inheriting this config: Solid code runs under a
    // DOM (`happy-dom`, as in the client), the transport/server/reactor tests
    // run in plain Node. A third project, `bench`, inherits nothing and runs the
    // benches against Solid's production tier.
    //
    // NO PROJECT INHERITING THIS CONFIG COLLECTS A BENCH. Under `vitest bench`
    // vitest expands a `<name> (bench)` project out of every project, cloning
    // its environment and setup files — which is how the dev tier reached the
    // bench before. The empty include lives here, on the root, rather than only
    // on each project, so a project added later is covered by default and only
    // `bench` (which extends nothing) overrides it.
    benchmark: { include: [] },
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: DOM_TESTS,
          // Joins the root `setupFiles` (`extends` concatenates the arrays):
          // fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
          setupFiles: ["@kolu/solid-test-setup/setup"],
          // Belt to the root's braces: the benches belong to the `bench`
          // project below, not to a `dom (bench)` variant derived from this
          // one, which would carry this project's dev-tier setup files.
          benchmark: { include: [] },
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: DOM_TESTS,
          benchmark: { include: [] },
        },
      },
      {
        // `extends: false`: since vitest 5 an inline project inherits the
        // declaring config by default, and the bench must NOT inherit the root
        // `solid()` dev posture or the dom setup. It measures what SHIPS —
        // Solid's production builds, with no attribution engine. The dev tier
        // is not an option here as well as being the wrong tier: the full
        // dev-tier run, with the engine installed through the inherited setup
        // file, died out of memory.
        extends: false,
        plugins: [solid({ dev: false })],
        environments: {
          client: { resolve: { conditions: PROD_CLIENT_CONDITIONS } },
          // The bench's own graph is inlined (`server.deps.inline` below), so
          // nothing in it is externalized and these SSR conditions go unused.
          // They are stated so
          // an externalized Solid consumer, were one ever added, resolves the
          // production server build rather than a development one.
          ssr: { resolve: { conditions: PROD_SERVER_CONDITIONS } },
        },
        test: {
          name: "bench",
          environment: "happy-dom",
          // The daemon gate only — NOT `@kolu/solid-test-setup/setup`, which
          // enables the attribution engine and throws outright when Solid
          // resolved to production.
          setupFiles: ["@kolu/daemon-test-gate/setup"],
          include: [],
          benchmark: { include: ["src/solid/**/*.bench.ts"] },
          server: { deps: { inline: [...SOLID_INLINE_DEPS_SCHEDULED] } },
        },
      },
    ],
    server: {
      deps: {
        // Load-bearing for the reactive tests: an externalized copy loads its
        // OWN core whose stores never share the test's reactive graph, so a
        // store update never re-runs an observing effect/memo (a `mapArray`
        // keyed off a subscription's value would never fan out).
        inline: [...SOLID_INLINE_DEPS_SCHEDULED],
      },
    },
  },
});
