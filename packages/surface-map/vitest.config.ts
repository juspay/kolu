import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// The tests that run the Solid map client. Every other test runs in Node.
const DOM_TESTS = [
  "src/clientPolicyOrigin.test.ts",
  "src/connectionOptionalKey.test.ts",
  "src/mapHarness.test.ts",
  "src/nestedSiblings.test.ts",
  "src/procedureUseVerb.test.ts",
  "src/scoped.test.ts",
  "src/siblingMount.test.ts",
  "src/watchByEntry.test.ts",
];

export default defineConfig({
  // The Solid JSX transform + the `useEntry` re-key atom (mapArray) need the real
  // reactive core. Mirrors `@kolu/surface`'s vitest config: pin every solid import
  // onto ONE browser-build core so stores share the test's reactive graph (an
  // externalized `solid-js/store` loads its own core copy whose updates never
  // re-run an observing effect/memo — a `mapArray` keyed off a subscription would
  // never fan out). See `@kolu/surface/vitest.config.ts` for the full rationale.
  plugins: [solid()],
  resolve: {
    alias: {
      "solid-js/store": new URL(
        "./node_modules/solid-js/store/dist/store.js",
        import.meta.url,
      ).pathname,
      "solid-js/web": new URL(
        "./node_modules/solid-js/web/dist/web.js",
        import.meta.url,
      ).pathname,
      "solid-js": new URL(
        "./node_modules/solid-js/dist/solid.js",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    // Two projects, both inheriting this config: the tests that drive the Solid
    // map client (`connectSurfaceMap`, `useEntry`, `scopedByEntry`) run under a
    // DOM (`happy-dom`, as in the client); the server-side map tests run in Node.
    projects: [
      {
        extends: true,
        test: { name: "dom", environment: "happy-dom", include: DOM_TESTS },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: DOM_TESTS,
        },
      },
    ],
    server: {
      deps: {
        inline: [/solid-js/, "@solid-primitives/scheduled"],
      },
    },
  },
});
