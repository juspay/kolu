import { defineConfig } from "vitest/config";

export default defineConfig({
  // Node's `"node"` export condition picks solid-js's SSR build, where
  // `createEffect` is a no-op. The tile latch (`onceMeasured`) is a real
  // effect — pin the browser bundle so the test is not a silent pass.
  resolve: {
    alias: {
      "solid-js": new URL(
        "./node_modules/solid-js/dist/solid.js",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    server: { deps: { inline: [/solid-js/] } },
  },
});
