import { defineConfig } from "vitest/config";

// A dedicated vitest config so the reuse-proof test runs as plain Node — it
// exercises createBrowser's logic and needs none of vite.config's solid plugin
// or `root: src/client` (which would hide src/docsite.test.ts).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
