import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

const rhaiGrammarPath = process.env.KOLU_RHAI_GRAMMAR;
if (!rhaiGrammarPath) {
  throw new Error(
    "KOLU_RHAI_GRAMMAR is not set. Run tests inside the Nix dev shell.",
  );
}

export default defineConfig({
  // The Solid JSX transform — so the `.test.tsx` render harness compiles its JSX
  // to real DOM. Harmless for the `.test.ts` files (no JSX).
  plugins: [solid()],
  // solid-js' package.json picks `dist/server.cjs` (the SSR build) under Node's
  // `"node"` export condition, where `createEffect` is a no-op. The render test
  // exercises real reactive effects (onMount), so pin every solid import to the
  // browser bundle directly — mirrors `packages/surface/vitest.config.ts`.
  resolve: {
    alias: {
      "kolu-rhai-grammar": rhaiGrammarPath,
      "solid-js/store": new URL(
        "./node_modules/solid-js/store/dist/store.js",
        import.meta.url,
      ).pathname,
      "solid-js/web": new URL(
        "./node_modules/solid-js/web/dist/web.js",
        import.meta.url,
      ).pathname,
      "solid-js": new URL(
        "./node_modules/solid-js/dist/solid.js",
        import.meta.url,
      ).pathname,
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
    server: { deps: { inline: [/solid-js/] } },
  },
});
