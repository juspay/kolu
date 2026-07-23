import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Files in this package exercise PTYs, unix sockets, and daemon gates.
    // Running them concurrently makes unrelated tests compete for the same
    // scarce OS resources and was the common cause of their timeout flakes.
    fileParallelism: false,
    // Scrub the production daemon-locator env in every worker so a test can
    // never reach a live daemon (#1334 adversary path). See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
  },
});
