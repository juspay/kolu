import { defineConfig } from "vitest/config";

export default defineConfig({
  // solid-js's package.json picks `dist/server.cjs` (the SSR build) under Node's
  // `"node"` export condition, where `createEffect` is a NO-OP. Without the alias,
  // any test that exercises a `createEffect`-driven derivation (the provider's
  // `gracedDown`-backed `presentingDown`, the lifecycle watchdog) silently runs
  // against a dead reactive graph — the effect never fires, so the test can't tell
  // a wired model from an unwired one. Aliasing pins every solid import to the
  // browser bundle's real `createEffect` (`resolve.conditions` alone is ignored for
  // externalized CJS deps under Vitest 4 + Node ESM), mirroring `@kolu/surface`'s
  // config. `solid-js/store` and `/web` precede the `solid-js` catch-all (which is
  // a prefix of both), so the specific keys win.
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
    include: ["src/**/*.test.ts"],
    environment: "node",
    server: {
      deps: {
        // Pull solid-js THROUGH Vitest's transform so the aliases above unify every
        // solid import onto ONE browser-build core (an externalized copy loads its
        // own core whose reactive graph never shares the test's). Same fix the
        // `@kolu/surface` and kolu-client test configs carry.
        inline: [/solid-js/, "@solid-primitives/scheduled"],
      },
    },
  },
});
