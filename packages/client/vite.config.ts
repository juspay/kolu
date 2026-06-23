import { surfaceApp } from "@kolu/surface-app/vite";
import tailwindcss from "@tailwindcss/vite";
import xtermPackage from "@xterm/xterm/package.json" with { type: "json" };
import { DEFAULT_PORT } from "kolu-common/config";
import { defineConfig, type PluginOption } from "vite";
import solid from "vite-plugin-solid";

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
  // No VitePWA / no *caching* service worker: kolu can't work offline and a
  // precaching worker only served stale builds across deploys (see
  // docs/cache-bug.md). Freshness is surface-app's contract: the server's
  // `no-store` shell + immutable hashed assets. In production kolu DOES register
  // one worker — a *fetch-less* notification worker (surface-app's
  // `NOTIFICATION_SW_SOURCE`, served at `/sw.js` via
  // `installFreshStatic({ serviceWorker: "notify" })`) so an installed PWA can
  // raise OS notifications; with no `fetch` handler it never caches, so freshness
  // still holds. That `/sw.js` is served by the prod server, not Vite, so it is
  // intentionally absent under `just dev` — `registerServiceWorker()` simply
  // no-ops there (registration fails → falls back to retiring any legacy worker).
  //
  // `surfaceApp()` injects the commit onto the `no-store` shell as
  // `window.__SURFACE_APP_COMMIT__` from kolu's `KOLU_COMMIT_HASH` env (→ git →
  // "dev"), the single commit source shared with the server cell. It rides the
  // shell, never a hashed-asset define: a define would bake the sha into an
  // `immutable` bundle whose name doesn't change on a stamp-only deploy, so
  // `koluStamped` (default.nix) seds `dist/index.html` and returning browsers
  // would stay pinned on the old stamp forever (kolu#1319).
  plugins: [
    solid(),
    tailwindcss(),
    surfaceApp({ commitEnvVar: "KOLU_COMMIT_HASH" }) as PluginOption,
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
    __XTERM_VERSION__: JSON.stringify(xtermVersion),
  },
  // Vite 8's experimental bundled dev mode: Rolldown bundles the app up front
  // instead of serving thousands of unbundled ESM modules, cutting cold dev
  // startup ~15× and full reloads ~10× on a graph this size. Strictly a
  // dev-server knob — it does NOT touch `vite build`, so the Nix-built,
  // content-hashed production bundle (koluStamped) is byte-for-byte unaffected
  // and stays reproducible. (The build-output experiments — chunk import map,
  // Wasm-as-build — are deliberately left off for exactly that reproducibility
  // reason.)
  experimental: {
    bundledDev: true,
  },
  // Pierre's syntax-highlight worker (@pierre/diffs/worker, spawned by
  // @kolu/solid-pierre's CodeView as a `{ type: "module" }` worker) code-splits
  // its Shiki grammars via dynamic import, which Vite's default `iife` worker
  // format can't emit. Module workers need the `es` format.
  worker: {
    format: "es",
  },
  // Pin BOTH esbuild targets to esnext. The production build (`build.target`)
  // and the dev dependency pre-bundle (`optimizeDeps.esbuildOptions.target`) are
  // separate knobs: build.target covers `vite build`, optimizeDeps covers the
  // `just dev` pre-bundle. Both must be esnext because esbuild ≥0.27.7 refuses
  // to lower destructuring to Vite's default browser target — that list includes
  // Safari 14.0, which esbuild's compat-table flags as not correctly supporting
  // destructuring (a real Safari 14.0 engine bug), and esbuild has no
  // destructuring-lowering transform. Dev assumes a modern browser, so there's
  // no reason to down-level deps there. Setting only build.target (kolu#1387)
  // left optimizeDeps on the browser default and broke `just dev`.
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
  build: {
    target: "esnext",
  },
});
