import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { DEFAULT_PORT } from "kolu-common/config";

const commitHash = process.env.KOLU_COMMIT_HASH || "dev";

const themesJsonPath = process.env.KOLU_THEMES_JSON;
if (!themesJsonPath) {
  throw new Error(
    "KOLU_THEMES_JSON env var is not set. Run inside the Nix devShell (just dev).",
  );
}

const fontsDir = process.env.KOLU_FONTS_DIR;
if (!fontsDir) {
  throw new Error(
    "KOLU_FONTS_DIR env var is not set. Run inside the Nix devShell (just dev).",
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
        // Raised from the 2 MiB default to accommodate the highlight.js +
        // lowlight bundle pulled in by @git-diff-view/solid. The Code
        // Diff tab's renderer ships syntax highlighting for dozens of
        // languages; precaching it keeps the tab snappy offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "ghostty-themes": themesJsonPath,
      "kolu-fonts": `${fontsDir}/fonts.css`,
    },
  },
  server: {
    port: 5173,
    // Prevent browser from caching dev assets — stale modules cause subtle bugs on refresh.
    headers: { "Cache-Control": "no-store" },
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
