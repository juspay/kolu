import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  root: "src/client",
  plugins: [solid()],
  server: { port: 5176 },
  // build.target esnext: this example ships modern code and never down-levels.
  build: {
    target: "esnext",
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
