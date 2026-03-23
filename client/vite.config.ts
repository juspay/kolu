import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { DEFAULT_PORT } from "kolu-common/config";

const themesJsonPath = process.env.KOLU_THEMES_JSON;
if (!themesJsonPath) {
  throw new Error(
    "KOLU_THEMES_JSON env var is not set. Run inside the Nix devShell (just dev).",
  );
}

const ghosttyWebPkgPath = process.env.GHOSTTY_WEB_PKG;
if (!ghosttyWebPkgPath) {
  throw new Error(
    "GHOSTTY_WEB_PKG env var is not set. Run inside the Nix devShell (just dev).",
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
      "ghostty-web": `${ghosttyWebPkgPath}/ghostty-web.js`,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ["..", ghosttyWebPkgPath],
    },
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
