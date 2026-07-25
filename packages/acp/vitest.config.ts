import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Every proxy test spawns real processes and binds a real unix socket in
    // $XDG_RUNTIME_DIR; serial files keep those measuring the subject rather
    // than contention with a sibling.
    fileParallelism: false,
    // A cancel that expires its grace window is a ~3s wait by construction.
    testTimeout: 30_000,
    // Scrub the production daemon-locator env in every worker so a test can
    // never reach a live daemon. See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
  },
});
