import { SOLID_INLINE_DEPS } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `/solid` primitives (scroll lock, render recovery, the component) need
  // the browser build's real reactive core. The plugin gives the DOM
  // environment below browser export conditions and Solid's development
  // builds, and compiles the component's JSX.
  plugins: [solid()],
  test: {
    include: ["src/**/*.test.ts"],
    // The kit drives real `@xterm/xterm` and `@xterm/headless` terminals plus
    // SolidJS `/solid` primitives, so it needs a DOM (xterm reads `window`,
    // `@solid-primitives/media` reads `matchMedia` at module load) and the
    // browser `@solidjs/web` build (`isServer === false`).
    environment: "happy-dom",
    // Fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
    setupFiles: ["@kolu/solid-test-setup/setup"],
    server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
  },
});
