import { defineConfig } from "vitest/config";

// mini-ci is a Node CLI (no Solid / DOM), so no resolve aliasing is needed
// — unlike the framework's own vitest config, which pins solid-js to its
// browser build.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
