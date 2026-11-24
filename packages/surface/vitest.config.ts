import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// The tests that RUN Solid live with the Solid client layer, under `src/solid/`:
// a test that drives the client or renders belongs there, and joins the DOM
// project by existing. Every other test runs in the Node project.
const DOM_TESTS = ["src/solid/**/*.test.{ts,tsx}"];

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
    // Two projects, both inheriting this config: Solid code runs under a DOM
    // (`happy-dom`, as in the client), the transport/server/reactor tests run in
    // plain Node.
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
        // Pull Solid, its framework packages and `@solid-primitives/scheduled`
        // THROUGH Vitest's transform so every solid import lands on ONE
        // browser-build core. Load-bearing for the reactive tests: an
        // externalized copy loads its OWN core whose stores never share the
        // test's reactive graph, so a store update never re-runs an observing
        // effect/memo (a `mapArray` keyed off a subscription's value would never
        // fan out).
        inline: [/solid-js/, /@solidjs\//, "@solid-primitives/scheduled"],
      },
    },
  },
});
