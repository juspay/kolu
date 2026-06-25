import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform — so `.test.tsx` files (the render harness) compile
  // their JSX to real DOM. Harmless for the `.test.ts` files (no JSX). The
  // per-file `// @vitest-environment happy-dom` docblock opts ONLY the render
  // tests into a DOM; the server/reactive tests stay on the node default.
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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // `vite-plugin-solid` defaults the test environment to `jsdom` (a dep we
    // don't carry); pin it back to `node` so the server/reactive `.test.ts`
    // files run plain, and let ONLY the render `.test.tsx` opt into a DOM via its
    // `// @vitest-environment happy-dom` docblock.
    environment: "node",
    server: {
      deps: {
        // Pull solid-js AND the @kolu/surface solid hooks THROUGH Vitest's
        // transform so the aliases above unify every solid import onto ONE
        // browser-build core — otherwise the externalized `solid-js/store`
        // node module loads its own core copy and its stores never share the
        // test's reactive graph (a store update never re-runs an effect).
        inline: [/solid-js/, /@kolu\/surface/],
      },
    },
  },
});
