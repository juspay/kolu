import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "src/client",
  plugins: [solid(), tailwindcss()],
  server: {
    port: 5175,
    proxy: {
      "/rpc": {
        target: "http://127.0.0.1:7720",
        ws: true,
      },
    },
  },
  // build.target esnext: this example ships modern code and never down-levels.
  // (The old `optimizeDeps.esbuildOptions.target` twin is gone — Vite 8 optimizes
  // deps with Rolldown/Oxc, not esbuild, so the esbuild destructuring-lowering
  // workaround no longer applies, and it's deprecated in Vite 8.)
  build: {
    target: "esnext",
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
