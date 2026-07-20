import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform, so a `.test.tsx` render harness compiles its JSX to
  // real DOM under happy-dom (mirrors `packages/surface/vitest.config.ts`).
  // `hot: false` — no solid-refresh under test (it needs the dev build and only
  // warns to stderr; the render tests don't hot-reload).
  plugins: [solid({ hot: false })],
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
    // The client is a BROWSER app: run its tests with a DOM so the browser
    // `solid-js/web` build is honest (`isServer === false`) and module-load-time
    // DOM access (`window.matchMedia` in `@solid-primitives/media`, etc.) works.
    // Required by `scopedByEntry`'s `keyArray` (`@solid-primitives/keyed`), which
    // takes a non-reactive SERVER branch when `isServer` is true — under the old
    // bare-node env its per-key roots never tracked, so a host's owner never
    // re-keyed. (fs-scanning tests resolve paths via `fileURLToPath(import.meta.url)`
    // — NOT `new URL(…, import.meta.url)`, which the happy-dom global `URL` rejects.)
    environment: "happy-dom",
    // Inline `solid-js` (+ `@solid-primitives/keyed`) so they are transformed with
    // the aliases above and resolve to the ONE browser-build core. Without this,
    // `@kolu/surface-map`'s `scopedByEntry` + `keyArray` load their own
    // externalized `solid-js` whose reactive graph never connects to the client's
    // signals (a cross-instance split — membership updates silently never re-run
    // the owner's memos). Same fix `packages/surface-map/vitest.config.ts` applies.
    server: { deps: { inline: [/solid-js/, "@solid-primitives/keyed"] } },
  },
});
