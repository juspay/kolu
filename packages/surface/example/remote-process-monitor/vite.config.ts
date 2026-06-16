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
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
