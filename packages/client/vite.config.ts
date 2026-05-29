import tailwindcss from "@tailwindcss/vite";
import xtermPackage from "@xterm/xterm/package.json" with { type: "json" };
import { DEFAULT_PORT } from "kolu-common/config";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

const commitHash = process.env.KOLU_COMMIT_HASH || "dev";
const xtermVersion = xtermPackage.version;

const fontsDir = process.env.KOLU_FONTS_DIR;
if (!fontsDir) {
  throw new Error(
    "KOLU_FONTS_DIR env var is not set. Run inside the Nix devShell (just dev).",
  );
}

// Dev proxy target. Defaults to the canonical server port; allow an override
// so multiple `just dev` instances (e.g. parallel worktrees) can each point
// their proxy at a server on a non-default port.
const devServerPort = Number(process.env.KOLU_DEV_SERVER_PORT) || DEFAULT_PORT;

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Raised from the 2 MiB default to accommodate the shiki bundle
        // pulled in by @pierre/diffs. Precaching keeps the Code tab snappy
        // offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "kolu-fonts": `${fontsDir}/fonts.css`,
    },
  },
  server: {
    port: Number(process.env.KOLU_DEV_CLIENT_PORT) || 5173,
    // Prevent browser from caching dev assets — stale modules cause subtle bugs on refresh.
    headers: { "Cache-Control": "no-store" },
    proxy: {
      "/api": `http://localhost:${devServerPort}`,
      "/manifest.webmanifest": `http://localhost:${devServerPort}`,
      "/rpc": {
        target: `http://localhost:${devServerPort}`,
        ws: true,
      },
    },
  },
  define: {
    __KOLU_COMMIT__: JSON.stringify(commitHash),
    __XTERM_VERSION__: JSON.stringify(xtermVersion),
  },
  build: {
    target: "esnext",
  },
});
