import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The end-to-end file serves a real surface over a real unix socket and
    // spawns a real CLI process per case; the default 5s is a hair tight for a
    // cold `tsx` boot on a loaded CI box.
    testTimeout: 30_000,
  },
});
