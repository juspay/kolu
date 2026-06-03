import tailwindcss from "@tailwindcss/vite";
import xtermPackage from "@xterm/xterm/package.json" with { type: "json" };
import { DEFAULT_PORT } from "kolu-common/config";
import { defineConfig } from "vite";
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
  // No VitePWA / service worker: kolu doesn't use one (it can't work offline and
  // a precaching worker only served stale builds across deploys — see
  // docs/cache-bug.md). Freshness is the server's `no-store` shell + immutable
  // hashed assets; `public/sw.js` is a self-destructing worker that retires any
  // SW an earlier build registered.
  plugins: [solid(), tailwindcss()],
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
