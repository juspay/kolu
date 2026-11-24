import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness compiles its
  // JSX to real DOM. The plugin gives the DOM environment browser export
  // conditions and Solid's development builds.
  plugins: [solid()],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // The package's one test renders `LogTail`, so the whole suite runs under a
    // DOM (`happy-dom`, as in the client). There is no pure test to give a Node
    // project; add one beside a `.test.ts` split when a pure test arrives.
    environment: "happy-dom",
    // Fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
    setupFiles: ["@kolu/solid-test-setup/setup"],
    server: { deps: { inline: [/solid-js/, /@solidjs\//] } },
  },
});
