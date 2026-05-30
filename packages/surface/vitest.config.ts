import { defineConfig } from "vitest/config";

export default defineConfig({
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
    include: ["src/**/*.test.ts"],
    // Inline `@solid-primitives/scheduled` so the `solid-js/web` alias above
    // reaches inside it — externalized node_modules deps bypass Vitest's
    // resolver, leaving `isServer === true` and turning `debounce` into a
    // no-op (the useCellLocal coalesce test would never see a flush).
    server: { deps: { inline: ["@solid-primitives/scheduled"] } },
  },
});
