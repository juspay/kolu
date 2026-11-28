import { SOLID_INLINE_DEPS } from "@kolu/solid-test-setup/vitest";
import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

const rhaiGrammarPath = process.env.KOLU_RHAI_GRAMMAR;
if (!rhaiGrammarPath) {
  throw new Error(
    "KOLU_RHAI_GRAMMAR is not set. Run tests inside the Nix dev shell.",
  );
}

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness compiles its JSX
  // to real DOM. The plugin gives the `dom` project browser export conditions
  // and Solid's development builds (the render test exercises real reactive
  // effects). Harmless for the `.test.ts` files (no JSX).
  plugins: [solid()],
  resolve: {
    alias: {
      "kolu-rhai-grammar": rhaiGrammarPath,
    },
  },
  test: {
    // Two projects, both inheriting this config, split by file name: a test
    // that needs a DOM — it renders, imports a Solid component module, or calls
    // a DOM API such as `CSS.escape` — is a `.test.tsx` and runs under
    // `happy-dom` (as in the client); a `.test.ts` is pure logic and runs in
    // Node.
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["src/**/*.test.tsx"],
          // Fails a test on any Solid dev diagnostic (`@kolu/solid-test-setup`).
          setupFiles: ["@kolu/solid-test-setup/setup"],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
    ],
    server: { deps: { inline: [...SOLID_INLINE_DEPS] } },
  },
});
