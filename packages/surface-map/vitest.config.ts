import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform + the `useEntry` re-key atom (mapArray) need the real
  // reactive core. Mirrors `@kolu/surface`'s vitest config: pin every solid import
  // onto ONE browser-build core so stores share the test's reactive graph (an
  // externalized `solid-js/store` loads its own core copy whose updates never
  // re-run an observing effect/memo — a `mapArray` keyed off a subscription would
  // never fan out). See `@kolu/surface/vitest.config.ts` for the full rationale.
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
    environment: "node",
    server: {
      deps: {
        inline: [/solid-js/, "@solid-primitives/scheduled"],
      },
    },
  },
});
