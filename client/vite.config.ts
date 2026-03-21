import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7681",
      "/ws": {
        target: "ws://localhost:7681",
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
});
