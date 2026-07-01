import { constants as zlibConstants } from "node:zlib";
import { ASSET_DIR } from "@kolu/surface-app";
import { surfaceApp } from "@kolu/surface-app/vite";
import tailwindcss from "@tailwindcss/vite";
import xtermPackage from "@xterm/xterm/package.json" with { type: "json" };
import { DEFAULT_PORT } from "kolu-common/config";
import { defineConfig, type PluginOption } from "vite";
import { compression, defineAlgorithm } from "vite-plugin-compression2";
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
    // Emit `.br` + `.gz` siblings for the immutable hashed assets at BUILD time,
    // so the production server (`@kolu/surface-app` installFreshStatic →
    // serve-static `precompressed`) serves them with the right `Content-Encoding`
    // and zero per-request CPU — the ~2.56 MB eager bundle drops to ~571 kB on
    // every cold / remote / phone load. Scoped to the `${ASSET_DIR}/` prefix — the
    // SAME immutable-asset dir surface-app serves precompressed under
    // (`DEFAULT_ASSET_PREFIX`) — so the build's compress-scope and the server's
    // serve-scope share one source of truth: nothing outside it gets a dead sibling
    // the server would never negotiate (the `no-store` `index.html` shell, whose
    // stamp is seded post-build — kolu#1319; the `public/` fonts + favicon the
    // server serves identity). Brotli at max quality since the cost is paid once at
    // build, not per request.
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
  // NOTE: Vite 8.1's experimental bundled dev mode (`experimental.bundledDev`)
  // is deliberately NOT enabled. It crashes kolu's client at runtime —
  // `Uncaught ReferenceError: __reExport is not defined` — so the app never
  // mounts under `just dev` (a Rolldown dev-bundling CJS-interop helper that
  // 8.1.0 references but doesn't emit). Standard Vite 8 dev works correctly;
  // revisit bundledDev when the upstream helper bug is fixed.
  // Pierre's syntax-highlight worker (@pierre/diffs/worker, spawned by
  // @kolu/solid-pierre's CodeView as a `{ type: "module" }` worker) code-splits
  // its Shiki grammars via dynamic import, which Vite's default `iife` worker
  // format can't emit. Module workers need the `es` format.
  worker: {
    format: "es",
  },
  // Production build targets esnext — kolu ships modern code and never
  // down-levels (`build.target` covers `vite build`).
  //
  // The old twin `optimizeDeps.esbuildOptions.target: "esnext"` is gone: Vite 8
  // pre-bundles dependencies with Rolldown/Oxc, not esbuild, so the esbuild
  // ≥0.27.7 destructuring-lowering bug that once forced it — esbuild refused to
  // lower destructuring to Vite's Safari-14-inclusive default target, which
  // broke `just dev` when only `build.target` was set (kolu#1387) — no longer
  // applies, and the dev pre-bundle already assumes a modern browser.
  // `optimizeDeps.esbuildOptions` is deprecated in Vite 8.
  build: {
    target: "esnext",
  },
});
