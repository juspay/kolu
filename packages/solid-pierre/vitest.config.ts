import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness compiles its JSX
  // to real DOM. Harmless for the `.test.ts` files (no JSX); the per-file
  // `// @vitest-environment happy-dom` docblock opts ONLY the render tests into a
  // DOM, leaving the pure-logic tests (pathReconcile) on the node default.
  plugins: [solid()],
  // solid-js' package.json picks `dist/server.cjs` (the SSR build) under Node's
  // `"node"` export condition, where `createEffect` is a no-op. The render test
  // exercises real reactive effects, so pin every solid import to the browser
  // bundle directly — mirrors `packages/surface/vitest.config.ts`.
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
    // `vite-plugin-solid` defaults the env to `jsdom`; pin it back to `node` so the
    // pure-logic `.test.ts` files run plain, and let ONLY the render `.test.tsx`
    // opt into a DOM via its `// @vitest-environment happy-dom` docblock.
    environment: "node",
    // Pull solid-js THROUGH Vitest's transform so the aliases above unify every
    // solid import onto ONE browser-build core (same fix surface + client carry).
    server: { deps: { inline: [/solid-js/] } },
  },
});
