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
  // build.target esnext: this example ships modern code and never down-levels.
  build: {
    target: "esnext",
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
