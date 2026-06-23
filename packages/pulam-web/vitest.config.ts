import { defineConfig } from "vitest/config";

export default defineConfig({
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
