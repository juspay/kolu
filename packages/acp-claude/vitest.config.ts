import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `src/` ONLY: `./adapter/session-list-info/facts.test.js` is the patch
    // generator's own suite, run by `bun test` from that directory (its README
    // says why it is plain JS — the file is spliced verbatim into a compiled
    // bundle). Vitest would find it and fail on `bun:test`.
    include: ["src/**/*.test.ts"],
  },
});
