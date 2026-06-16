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
  build: {
    // esnext (matches packages/client): this example ships modern code, and
    // esbuild 0.28+ hard-errors when asked to lower SolidJS's destructuring
    // output to vite's default browser target.
    target: "esnext",
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
