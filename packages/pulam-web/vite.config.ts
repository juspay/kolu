/**
 * Vite config for pulam-web's browser client — the twin of `packages/client`'s
 * toolchain, stripped to the leaf this surface needs: just `vite-plugin-solid`
 * (no Tailwind, no surface-app PWA plugin — R4.8a renders a plain monospace
 * fleet list, the polished mockup is R4.8b).
 *
 * The dev proxy points `/rpc` (WebSocket, `ws: true`) and `/api` at the Node
 * backend (`src/server/main.ts`, default port 4800) so `pnpm dev:client` and
 * `pnpm dev:server` run side-by-side: the browser hits Vite on 5800, Vite
 * forwards the surface socket + the host-list fetch to the backend. Never used
 * in production — there the backend serves the BUILT `dist/` itself via
 * `installFreshStatic`.
 */

import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// The backend the dev proxy forwards to. Mirrors the server's `PORT` default
// (see `src/server/config.ts`) so a plain `pnpm dev:server` + `pnpm dev:client`
// pair just works with no extra env.
const BACKEND_PORT = Number(process.env.PULAM_WEB_PORT) || 4800;
const CLIENT_PORT = Number(process.env.PULAM_WEB_CLIENT_PORT) || 5800;

export default defineConfig({
  plugins: [solid()],
  server: {
    port: CLIENT_PORT,
    // No-store the dev shell so a reload never serves a stale index against a
    // restarted backend (the same freshness stance `installFreshStatic` bakes
    // for production).
    headers: { "Cache-Control": "no-store" },
    proxy: {
      "/api": `http://localhost:${BACKEND_PORT}`,
      "/rpc": {
        target: `http://localhost:${BACKEND_PORT}`,
        ws: true,
      },
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
  optimizeDeps: {
    esbuildOptions: { target: "esnext" },
  },
});
