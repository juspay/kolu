import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The padi suite owns real subprocesses, sockets, and PTYs. Keep files
    // serial within the package so their liveness checks measure the subject,
    // not contention created by sibling test files.
    fileParallelism: false,
    // Scrub the production daemon-locator env in every worker so a test can
    // never reach a live daemon (#1334 adversary path). See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
  },
});
