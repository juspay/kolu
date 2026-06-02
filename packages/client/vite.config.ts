import tailwindcss from "@tailwindcss/vite";
import xtermPackage from "@xterm/xterm/package.json" with { type: "json" };
import { DEFAULT_PORT } from "kolu-common/config";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import solid from "vite-plugin-solid";

const commitHash = process.env.KOLU_COMMIT_HASH || "dev";
const xtermVersion = xtermPackage.version;

// Ports for the dev instance. Default to the canonical 7681/5173 so a bare
// `just dev` is stable; `just dev SERVER_PORT=… CLIENT_PORT=…` (or `just
// dev-auto`) overrides both so a second instance can coexist with a primary
// one. The proxy target MUST follow KOLU_DEV_SERVER_PORT — otherwise a
// non-default client silently proxies /api and /rpc to the primary server.
const serverPort = process.env.KOLU_DEV_SERVER_PORT || String(DEFAULT_PORT);
const clientPort = Number(process.env.KOLU_DEV_CLIENT_PORT) || 5173;

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
      // `prompt`, not `autoUpdate`: a new build must NOT reload an open tab out
      // from under a live terminal session. `prompt` keeps the freshly-built
      // worker in `waiting` until the user clicks Reload (see pwa.ts), whereas
      // `autoUpdate` force-reloads on activation with no way to defer on the
      // pinned plugin version. The worker still updates its precache eagerly;
      // only the navigation is user-gated.
      registerType: "prompt",
      // `pwa.ts` registers the worker itself (via `virtual:pwa-register`) so it
      // can own update detection and the reload — `false` tells the plugin not
      // to also auto-inject a registration, which would double-register.
      injectRegister: false,
      manifest: false,
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Raised from the 2 MiB default to accommodate the shiki bundle
        // pulled in by @pierre/diffs. Precaching keeps the Code tab snappy
        // offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Take control of the page the moment the waiting worker is told to
        // skip waiting (on the user's Reload click) so the `controllerchange`
        // fires and the reload lands on the new build — `skipWaiting` stays
        // off so the worker waits for that click rather than activating eagerly.
        clientsClaim: true,
      },
    }),
  ],
  resolve: {
    alias: {
      "kolu-fonts": `${fontsDir}/fonts.css`,
    },
  },
  server: {
    port: clientPort,
    // Prevent browser from caching dev assets — stale modules cause subtle bugs on refresh.
    headers: { "Cache-Control": "no-store" },
    proxy: {
      "/api": `http://localhost:${serverPort}`,
      "/manifest.webmanifest": `http://localhost:${serverPort}`,
      "/rpc": {
        target: `http://localhost:${serverPort}`,
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
