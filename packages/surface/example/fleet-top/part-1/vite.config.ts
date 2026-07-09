import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "src/client",
  plugins: [solid()],
  server: {
    port: 5175,
    proxy: {
      "/rpc": { target: "http://127.0.0.1:7730", ws: true },
    },
  },
  build: { target: "esnext", outDir: "../../dist", emptyOutDir: true },
});
