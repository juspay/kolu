import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Scrub the production daemon-locator env in every worker so a test can never
    // reach a live daemon (juspay/kolu#1334). See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
  },
});
