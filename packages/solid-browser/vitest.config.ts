import { SOLID_INLINE_DEPS } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// Scope collection to this package's own src — the nested example/docsite has
// its own suite (run via its own `test:unit`), so it must not be double-
// collected here.
export default defineConfig({
  // `createBrowser` is a reactive controller: the plugin gives it browser
  // export conditions and Solid's DEVELOPMENT build, where writes stage and
  // the diagnostics exist.
  plugins: [solid()],
  test: {
    include: ["src/**/*.test.ts"],
    // Solid's browser build wants a DOM (`isServer === false`).
    environment: "happy-dom",
    // Fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
    setupFiles: ["@kolu/solid-test-setup/setup"],
    // One solid core for the whole run, through Vitest's transform.
    server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
  },
});
