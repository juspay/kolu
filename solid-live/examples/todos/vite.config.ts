import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  root: __dirname,
  build: { target: "esnext" },
  server: {
    port: 5174,
    proxy: {
      "/rpc": { target: "http://localhost:3124", ws: true },
    },
  },
});
