import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

const themesJsonPath = process.env.KOLU_THEMES_JSON;
if (!themesJsonPath) {
  throw new Error(
    "KOLU_THEMES_JSON env var is not set. Run inside the Nix devShell (just dev).",
  );
}

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      "ghostty-themes": themesJsonPath,
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:7681",
      "/rpc": {
        target: "http://localhost:7681",
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
});
