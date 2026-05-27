import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    // The watcher fan-out tests (`packages/integrations/git/src/index.test.ts`
    // "a HEAD change fans out to every subscriber") wait up to 5000ms across
    // two sequential `waitFor` calls — exactly equal to vitest's default. A
    // single slow inotify/FSEvents tick on a loaded darwin runner pushes the
    // test past the envelope and into a timeout that cascades into every
    // following test's `afterEach` (#955). Give the wait budget 3× margin.
    testTimeout: 15_000,
  },
});
