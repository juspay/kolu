import { constants as zlibConstants } from "node:zlib";
import { ASSET_DIR, NOTIFICATION_SW_SOURCE } from "@kolu/surface-app";
import { surfaceApp } from "@kolu/surface-app/vite";
import tailwindcss from "@tailwindcss/vite";
import xtermPackage from "@xterm/xterm/package.json" with { type: "json" };
import { DEFAULT_PORT } from "kolu-common/config";
import { defineConfig, type PluginOption } from "vite";
import { compression, defineAlgorithm } from "vite-plugin-compression2";
import solid from "vite-plugin-solid";

const xtermVersion = xtermPackage.version;

const devNotificationSw: PluginOption = {
  name: "kolu:dev-notification-sw",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/sw.js", (_req, res) => {
      res.setHeader("Content-Type", "text/javascript");
      res.setHeader("Cache-Control", "no-store");
      res.end(NOTIFICATION_SW_SOURCE);
    });
  },
};

const serverPort = process.env.KOLU_DEV_SERVER_PORT || String(DEFAULT_PORT);
const clientPort = Number(process.env.KOLU_DEV_CLIENT_PORT) || 5173;

const fontsDir = process.env.KOLU_FONTS_DIR;
if (!fontsDir) {
  throw new Error(
    "KOLU_FONTS_DIR env var is not set. Run inside the Nix devShell (just dev).",
  );
}
const rhaiGrammarPath = process.env.KOLU_RHAI_GRAMMAR;
if (!rhaiGrammarPath) {
  throw new Error(
    "KOLU_RHAI_GRAMMAR env var is not set. Run inside the Nix devShell.",
  );
}

export default defineConfig({
  plugins: [
    devNotificationSw,
    solid(),
    tailwindcss(),
    surfaceApp({ commitEnvVar: "KOLU_COMMIT_HASH" }) as PluginOption,
    compression({
      algorithms: [
        defineAlgorithm("brotliCompress", {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
        }),
        "gzip",
      ],
      include: [
        new RegExp(
          `(?:^|/)${ASSET_DIR}/.+\\.(?:js|mjs|css|json|svg|wasm|ico)$`,
        ),
      ],
      threshold: 1024,
      skipIfLargerOrEqual: true,
    }) as PluginOption,
  ],
  resolve: {
    alias: {
      "kolu-rhai-grammar": rhaiGrammarPath,
      "kolu-fonts": `${fontsDir}/fonts.css`,
    },
  },
  server: {
    port: clientPort,
    allowedHosts: true,
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
    __XTERM_VERSION__: JSON.stringify(xtermVersion),
  },
  // Pierre's syntax-highlight worker (@pierre/diffs/worker, spawned by
  // @kolu/solid-pierre's CodeView as a `{ type: "module" }` worker) code-splits
  // its Shiki grammars via dynamic import, which Vite's default `iife` worker
  // format can't emit. Module workers need the `es` format.
  worker: {
    format: "es",
  },
  build: {
    target: "esnext",
  },
});
