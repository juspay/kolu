import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness compiles its
  // JSX to real DOM.
  plugins: [solid()],
  // solid-js' package.json picks `dist/server.cjs` (the SSR build) under Node's
  // `"node"` export condition, where `createEffect` is a no-op. The render tests
  // exercise real reactive rendering, so pin every solid import to the browser
  // bundle directly — mirrors `packages/solid-dockrow/vitest.config.ts`.
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
    // The package's one test renders `LogTail`, so the whole suite runs under a
    // DOM (`happy-dom`, as in the client). There is no pure test to give a Node
    // project; add one beside a `.test.ts` split when a pure test arrives.
    environment: "happy-dom",
    server: { deps: { inline: [/solid-js/] } },
  },
});
