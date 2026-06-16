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
  build: {
    // esnext (matches packages/client): this example ships modern code, and
    // esbuild 0.28+ hard-errors when asked to lower SolidJS's destructuring
    // output to vite's default browser target.
    target: "esnext",
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
