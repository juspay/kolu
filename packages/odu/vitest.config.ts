import { defineConfig } from "vitest/config";

// odu is a Node CLI (no Solid / DOM), so no resolve aliasing is needed —
// same shape as the mini-ci example it grew out of.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
