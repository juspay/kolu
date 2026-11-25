import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// The tests that RUN Solid live with the Solid client layer, under `src/solid/`
// (the same rule as `@kolu/surface`'s config): they join the DOM project by
// existing. Every other test runs in the Node project.
const DOM_TESTS = ["src/solid/**/*.test.{ts,tsx}"];

export default defineConfig({
  // The plugin picks each project's posture from its environment. The `dom`
  // project gets browser export conditions and Solid's DEVELOPMENT builds — the
  // real reactive core every `createEffect`-driven derivation here needs (the
  // provider's `gracedDown`-backed `presentingDown`, the lifecycle watchdog); a
  // server build would run them against a dead graph, and the test could not
  // tell a wired model from an unwired one.
  plugins: [solid()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: DOM_TESTS,
          // Fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
          setupFiles: ["@kolu/solid-test-setup/setup"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: DOM_TESTS,
        },
      },
    ],
    server: {
      deps: {
        // Pull Solid THROUGH Vitest's transform so every solid import lands on
        // ONE browser-build core (an externalized copy loads its own core whose
        // reactive graph never shares the test's). Same fix the `@kolu/surface`
        // and kolu-client test configs carry.
        inline: [/solid-js/, /@solidjs\//, "@solid-primitives/scheduled"],
      },
    },
  },
});
