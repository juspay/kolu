import { defineConfig } from "vitest/config";

export default defineConfig({
  // solid-js's package.json picks `dist/server.cjs` (the SSR build) under
  // Node's `"node"` export condition, where `createEffect` is a no-op.
  // Tests that exercise reactive primitives (e.g. `createReactiveSubscription`)
  // need the browser build's real `createEffect`. Aliasing pins the import
  // to the browser bundle directly — `resolve.conditions` alone is ignored
  // for externalized CJS deps under Vitest 4 + Node ESM.
  resolve: {
    alias: {
      "solid-js/store": new URL(
        "./node_modules/solid-js/store/dist/store.js",
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
  },
});
