import { SOLID_INLINE_DEPS_SCHEDULED } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform + the `useEntry` re-key atom (mapArray) need the real
  // reactive core: the plugin gives the DOM environment below browser export
  // conditions and Solid's development builds. Mirrors `@kolu/surface`'s vitest
  // config.
  plugins: [solid()],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The whole suite runs under a DOM (`happy-dom`, as in the client): every
    // test but one imports the Solid map client, directly or through
    // `mapHarness.testlib`, so a new test joins the DOM by existing. The one
    // pure test runs there too.
    environment: "happy-dom",
    // Fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
    setupFiles: ["@kolu/solid-test-setup/setup"],
    server: {
      deps: {
        // An externalized store loads its own core copy whose updates never
        // re-run an observing effect/memo, so a `mapArray` keyed off a
        // subscription would never fan out.
        inline: [...SOLID_INLINE_DEPS_SCHEDULED],
      },
    },
  },
});
