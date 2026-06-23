import { surfaceApp } from "@kolu/surface-app/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// `surfaceApp()` resolves the commit (SURFACE_APP_COMMIT env → git → "dev") and
// injects it onto the shell as `window.__SURFACE_APP_COMMIT__` (read via
// `shellCommit()`) — never a bundler define inside a hashed asset (kolu#1319).
export default defineConfig({
  root: "src/client",
  plugins: [solid(), surfaceApp()],
  server: {
    port: 5175,
    proxy: {
      "/rpc": { target: "http://127.0.0.1:7710", ws: true },
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
