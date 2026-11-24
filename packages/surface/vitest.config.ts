import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

// The tests that RUN Solid — every client-layer test under `src/solid/`, plus the
// two outside it that drive the Solid client (`collectionDeltas` through the
// `createRoot` deltas harness, `memberFace` through `surfaceClient`). They run in
// the DOM project; every other test runs in the Node project.
const DOM_TESTS = [
  "src/solid/**/*.test.{ts,tsx}",
  "src/collectionDeltas.test.ts",
  "src/memberFace.test.ts",
];

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness (`SurfaceGate`)
  // compiles its JSX to real DOM. Harmless for the `.test.ts` files (no JSX).
  plugins: [solid()],
  // solid-js's package.json picks `dist/server.cjs` (the SSR build) under
  // Node's `"node"` export condition, where `createEffect` is a no-op.
  // Tests that exercise reactive primitives (createSubscription /
  // createReactiveSubscription) need the browser build's real `createEffect`.
  // Aliasing pins the import to the browser bundle directly — `resolve.conditions`
  // alone is ignored for externalized CJS deps under Vitest 4 + Node ESM.
  //
  // `solid-js/web` must alias to the browser build too: under Node it resolves
  // to the server bundle where `isServer === true`, which turns
  // `@solid-primitives/scheduled`'s `debounce` into a no-op (it short-circuits
  // on SSR). The `useCellLocal` coalesce test needs the real timer-backed
  // debounce. Order matters — the `solid-js` catch-all is a prefix of the
  // others, so the specific keys must precede it.
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
    // Scrub the production daemon-locator env in every worker so a test can
    // never reach a live daemon (#1334 adversary path). See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
    // Two projects, both inheriting this config: Solid code runs under a DOM
    // (`happy-dom`, as in the client), the transport/server/reactor tests run in
    // plain Node. Each project names its environment, so `vite-plugin-solid`'s
    // `jsdom` default never applies.
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
        // Pull solid-js (and `@solid-primitives/scheduled`) THROUGH Vitest's
        // transform so the aliases above unify every solid import onto ONE
        // browser-build core. Inlining `solid-js` is load-bearing for the
        // reactive tests: an externalized `solid-js/store` node module loads its
        // OWN core copy whose stores never share the test's reactive graph, so a
        // store update never re-runs an observing effect/memo (a `mapArray` keyed
        // off a subscription's value would never fan out). Inlining unifies the
        // graph — the same fix the kolu client (pulam-web) test config carries.
        inline: [/solid-js/, "@solid-primitives/scheduled"],
      },
    },
  },
});
