import { defineConfig } from "vitest/config";
import { SOLID_INLINE_DEPS } from "./src/vitest.ts";

/**
 * The setup file's own project — it loads ITSELF as the setup file, which is
 * the only way to test what a test gets.
 *
 * No `@solidjs/vite-plugin` here, and no DOM: this package depends on
 * `solid-js` alone (it is a dev dependency of every Solid project, so its own
 * dependencies are everyone's), and its tests are reactive-graph tests with no
 * JSX. What the plugin would otherwise give is named outright — Solid's
 * DEVELOPMENT browser build, which is where `OBSERVE` and the diagnostics
 * exist; the server build has neither and runs no effects.
 */
const SOLID_DEV_CONDITIONS = ["development", "browser"];

export default defineConfig({
  resolve: { conditions: SOLID_DEV_CONDITIONS },
  ssr: { resolve: { conditions: SOLID_DEV_CONDITIONS } },
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/setup.ts"],
    server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
  },
});
