import { SOLID_INLINE_DEPS } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

// The one file here that RUNS Solid: `lockstepMirror` drives xterm-kit's
// `/write-door` primitives (`createScrollLock`, `createOutputCoalesce`) inside
// a `createRoot`, so it belongs in a DOM project on Solid's development build,
// where the diagnostics exist.
const DOM_TESTS = ["src/lockstepMirror.test.ts"];

export default defineConfig({
  // Browser export conditions and Solid's DEVELOPMENT builds for the `dom`
  // project; the `node` project keeps the server posture, which none of its
  // tests reach Solid through.
  plugins: [solid()],
  test: {
    // Files in this package exercise PTYs, unix sockets, and daemon gates.
    // Running them concurrently makes unrelated tests compete for the same
    // scarce OS resources and was the common cause of their timeout flakes.
    fileParallelism: false,
    // Scrub the production daemon-locator env in every worker so a test can
    // never reach a live daemon (#1334 adversary path). See @kolu/daemon-test-gate.
    setupFiles: ["@kolu/daemon-test-gate/setup"],
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: DOM_TESTS,
          // Joins the root `setupFiles` (`extends` concatenates the arrays):
          // fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
          setupFiles: ["@kolu/solid-test-setup/setup"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: DOM_TESTS,
        },
      },
    ],
    // One browser-build core for every solid import in the `dom` project.
    server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
  },
});
