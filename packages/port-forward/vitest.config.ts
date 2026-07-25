import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The lifetime test forks a real child that opens a real ssh forward, and
    // relay.test.ts binds real sockets — keep the files serial so their liveness
    // checks measure the subject, not contention with a sibling file.
    fileParallelism: false,
    // Scrub the production daemon-locator env in every worker so a test can
    // never reach a live daemon (#1334 adversary path). See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
  },
});
