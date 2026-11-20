import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    setupFiles: ["@kolu/daemon-test-gate/setup"],
  },
});
