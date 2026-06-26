import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness (`SurfaceGate`)
  // compiles its JSX to real DOM. Harmless for the `.test.ts` files (no JSX); the
  // per-file `// @vitest-environment happy-dom` docblock opts ONLY the render
  // tests into a DOM, leaving the reactive/primitive tests on the node default.
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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // `vite-plugin-solid` defaults the test environment to `jsdom`; pin it back
    // to `node` so the reactive/primitive `.test.ts` files run plain, and let
    // ONLY the render `.test.tsx` opt into a DOM via its
    // `// @vitest-environment happy-dom` docblock.
    environment: "node",
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
