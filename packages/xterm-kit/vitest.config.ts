import { defineConfig } from "vitest/config";

export default defineConfig({
  // solid-js's package.json picks `dist/server.cjs` (the SSR build) under Node's
  // `"node"` export condition, where `createEffect` is a no-op. The `/solid`
  // primitives (scroll lock, render recovery, the component) need the browser
  // build's real reactive core. Aliasing pins the import to the browser bundle —
  // `resolve.conditions` alone is ignored for externalized CJS deps under Vitest
  // 4 + Node ESM. Mirrors `packages/client/vitest.config.ts`.
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
    // The kit drives real `@xterm/xterm` and `@xterm/headless` terminals plus
    // SolidJS `/solid` primitives, so it needs a DOM (xterm reads `window`,
    // `@solid-primitives/media` reads `matchMedia` at module load) and the
    // browser `solid-js/web` build (`isServer === false`).
    environment: "happy-dom",
    server: { deps: { inline: [/solid-js/] } },
  },
});
