/**
 * Vite config for pulam-web's browser client — the twin of `packages/client`'s
 * toolchain, stripped to the leaf this surface needs: `vite-plugin-solid` plus
 * `@tailwindcss/vite` (the repo-wide styling mechanism — utilities only, per the
 * `styling-tailwind-only` rule). No surface-app PWA plugin — R4.8a renders a
 * plain monospace fleet list, the polished mockup is R4.8b.
 *
 * The dev proxy points `/rpc` (WebSocket, `ws: true`) and `/api` at the Node
 * backend (`src/server/main.ts`, default port 4800) so `pnpm dev:client` and
 * `pnpm dev:server` run side-by-side: the browser hits Vite on 5800, Vite
 * forwards the surface socket + the host-list fetch to the backend. Never used
 * in production — there the backend serves the BUILT `dist/` itself via
 * `installFreshStatic`.
 */

import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
// Import the port helpers from `ports.ts` (NOT `config.ts`): Vite loads this
// config through native ESM, and `config.ts` pulls `@kolu/surface-nix-host`,
// whose barrel's extensionless imports native ESM can't resolve — which would
// break the client build (and `nix run .#pulam-web`). `ports.ts` depends on
// nothing but the stdlib. See `ports.ts` for the full rationale.
import {
  DEFAULT_CLIENT_PORT,
  DEFAULT_PORT,
  parsePort,
} from "./src/server/ports.ts";

// The backend the dev proxy forwards to, and Vite's own client port. Mirrors the
// server's `PORT` default (see `src/server/config.ts`) so a plain `pnpm
// dev:server` + `pnpm dev:client` pair just works with no extra env. Parsed via
// the SAME `parsePort` the backend uses — a malformed/0 port fails fast here too,
// not silently collapses to the default.
const BACKEND_PORT = parsePort(
  "PULAM_WEB_PORT",
  process.env.PULAM_WEB_PORT,
  DEFAULT_PORT,
);
const CLIENT_PORT = parsePort(
  "PULAM_WEB_CLIENT_PORT",
  process.env.PULAM_WEB_CLIENT_PORT,
  DEFAULT_CLIENT_PORT,
);

export default defineConfig({
  plugins: [tailwindcss(), solid()],
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
  // Vite 8's experimental bundled dev mode (twin of packages/client): Rolldown
  // bundles up front for ~15× faster cold `pnpm dev:client` startup. Dev-only —
  // never affects the Nix-built `dist/` the production server serves, so the
  // build stays reproducible.
  experimental: {
    bundledDev: true,
  },
});
