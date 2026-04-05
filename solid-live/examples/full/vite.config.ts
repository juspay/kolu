import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  root: __dirname,
  build: { target: "esnext" },
  server: {
    port: 5173,
    proxy: {
      "/rpc": { target: "http://localhost:3123", ws: true },
    },
  },
});
