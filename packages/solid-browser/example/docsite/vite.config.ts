import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "src/client",
  plugins: [solid()],
  server: { port: 5176 },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
