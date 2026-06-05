import { defineConfig } from "vitest/config";

// Scope collection to this package's own src — the nested example/docsite has
// its own suite (run via its own `test:unit`), so it must not be double-
// collected here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
