import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "src/client",
  plugins: [solid(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      "/rpc": {
        target: "http://127.0.0.1:7700",
        ws: true,
      },
    },
  },
  // esnext for both the dev pre-bundle and the production build (matches
  // packages/client): this example ships modern code, and esbuild ≥0.27.7
  // refuses to lower destructuring to vite's default browser target (which
  // includes Safari 14.0, flagged as not correctly supporting destructuring).
  // build.target covers `vite build`; optimizeDeps covers the `pnpm dev`
  // pre-bundle — set both or the dev server breaks.
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
  build: {
    target: "esnext",
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
