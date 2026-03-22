import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { DEFAULT_PORT } from "kolu-common/config";

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
      "/api": `http://localhost:${DEFAULT_PORT}`,
      "/rpc": {
        target: `http://localhost:${DEFAULT_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
});
