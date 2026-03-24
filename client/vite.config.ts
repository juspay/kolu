import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { DEFAULT_PORT } from "kolu-common/config";

const commitHash =
  process.env.KOLU_COMMIT_HASH ||
  (() => {
    try {
      return execSync("git rev-parse --short HEAD", {
        encoding: "utf-8",
      }).trim();
    } catch {
      return "dev";
    }
  })();

const themesJsonPath = process.env.KOLU_THEMES_JSON;
if (!themesJsonPath) {
  throw new Error(
    "KOLU_THEMES_JSON env var is not set. Run inside the Nix devShell (just dev).",
  );
}

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "ghostty-themes": themesJsonPath,
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${DEFAULT_PORT}`,
      "/manifest.webmanifest": `http://localhost:${DEFAULT_PORT}`,
      "/rpc": {
        target: `http://localhost:${DEFAULT_PORT}`,
        ws: true,
      },
    },
  },
  define: {
    __KOLU_COMMIT__: JSON.stringify(commitHash),
  },
  build: {
    target: "esnext",
  },
});
