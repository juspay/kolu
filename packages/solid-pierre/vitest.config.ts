import solid from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

const rhaiGrammarPath = process.env.KOLU_RHAI_GRAMMAR;
if (!rhaiGrammarPath) {
  throw new Error(
    "KOLU_RHAI_GRAMMAR is not set. Run tests inside the Nix dev shell.",
  );
}

export default defineConfig({
  plugins: [solid()],
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
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    server: { deps: { inline: [/solid-js/] } },
  },
});
