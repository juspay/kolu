import { surfaceApp } from "@kolu/surface-app/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// `surfaceApp()` resolves the commit (SURFACE_APP_COMMIT env → git → "dev") and
// injects `__SURFACE_APP_COMMIT__` — no define, no sha literal, no env.d.ts here.
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
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
