/**
 * Server entry — Hono for static assets, a plain `ws` server for the surface.
 *
 * Effect RPC speaks ndjson over ONE bidirectional transport, so a surface has a
 * single browser-facing leg: the WebSocket. Every call — a cell subscription, a
 * collection delta stream, an imperative `notes.create` — rides it. (The old
 * second, HTTP arm went away with oRPC; there is nothing left for a cross-site
 * POST to reach, so only the ws upgrade needs the CSWSH origin gate.)
 *
 * `serveSurfaceSocket({ group, handlers, socket })` is the dispatch step: it
 * stands a per-connection Effect RPC server over the SHARED handlers, buffering
 * inbound frames until that server has attached its listener (a reconnecting
 * client re-issues its subscriptions in the same tick as the upgrade).
 *
 * No HTTPS, no auth, no migrations — just enough wiring to demonstrate the
 * framework end-to-end. Static client is served from
 * `KOLU_SURFACE_EXAMPLE_DIST` (set by the Nix wrapper) when present;
 * otherwise the dev path is "Vite serves the client on its own port,
 * Hono only handles `/rpc/*`".
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import {
  type ServableSocket,
  serveSurfaceSocket,
} from "@kolu/surface-app/server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { runtime } from "./serve";

const PORT = Number(process.env.PORT ?? 7700);
const HOST = process.env.HOST ?? "127.0.0.1";
// CSWSH gate: same-origin always allowed; `ALLOWED_ORIGINS` lists extra
// browser origins for a reverse-proxy front-end. See the upgrade handler.
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const DIST_DIR = process.env.KOLU_SURFACE_EXAMPLE_DIST;

const app = new Hono();

// ── Static client (Nix-build mode) ────────────────────────────────────
if (DIST_DIR && existsSync(DIST_DIR)) {
  app.get("*", (c) => {
    const url = new URL(c.req.url);
    const filePath =
      url.pathname === "/"
        ? join(DIST_DIR, "index.html")
        : join(DIST_DIR, url.pathname);
    const safe = resolve(filePath);
    if (!safe.startsWith(resolve(DIST_DIR))) return c.notFound();
    const target = existsSync(safe) ? safe : join(DIST_DIR, "index.html");
    const body = readFileSync(target);
    return new Response(new Uint8Array(body), {
      headers: { "content-type": guessContentType(target) },
    });
  });
}

function guessContentType(p: string): string {
  if (p.endsWith(".html")) return "text/html; charset=utf-8";
  if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (p.endsWith(".css")) return "text/css; charset=utf-8";
  if (p.endsWith(".svg")) return "image/svg+xml";
  if (p.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

// ── HTTP server bind via @hono/node-server ────────────────────────────
const server = serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    const where = `http://${info.address}:${info.port}`;
    console.log(`@kolu/surface-example listening on ${where}`);
    if (!DIST_DIR) {
      console.log(
        "  (no KOLU_SURFACE_EXAMPLE_DIST set — start Vite separately for the client)",
      );
    }
  },
);

// ── WebSocket: the surface's one transport ────────────────────────────
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (peer) => {
  const serving = serveSurfaceSocket({
    group: runtime.group,
    handlers: runtime.handlers,
    // `ws`'s socket satisfies `ServableSocket` structurally; its typings
    // narrow `addEventListener` per event name, which the generic seam does not.
    socket: peer as unknown as ServableSocket,
  });
  // A serving site OWNS `done`: it resolves when the peer hangs up and REJECTS
  // if the serving stack itself failed. An ignored rejection is an unhandled
  // one — a silently dead connection deserves the loud channel.
  serving.done.catch((err) => {
    console.error("surface connection failed:", err);
  });
});
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/rpc/ws")) {
    // CSWSH gate — reject a cross-site browser Origin before we upgrade.
    if (gateWsOrigin(req, socket, { allowedOrigins: ALLOWED_ORIGINS })) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});
