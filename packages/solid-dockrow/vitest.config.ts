import { SOLID_INLINE_DEPS } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness compiles its
  // JSX to real DOM. The plugin gives the `dom` project browser export
  // conditions and Solid's development builds. Harmless for the `.test.ts`
  // files (no JSX).
  plugins: [solid()],
  test: {
    // Two projects, both inheriting this config: the render tests (`.test.tsx`)
    // run under a DOM (`happy-dom`, as in the client); the pure folds run in Node.
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx"],
          // Fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
          setupFiles: ["@kolu/solid-test-setup/setup"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
    ],
    server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
  },
});
