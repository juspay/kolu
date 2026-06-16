/**
 * Server entry — Hono + WebSocket bound to oRPC's `RPCHandler`.
 *
 * No HTTPS, no auth, no migrations — just enough wiring to demonstrate
 * the framework end-to-end. Static client is served from
 * `KOLU_SURFACE_EXAMPLE_DIST` (set by the Nix wrapper) when present;
 * otherwise the dev path is "Vite serves the client on its own port,
 * Hono only handles `/rpc/*`".
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serve } from "@hono/node-server";
import {
  gateHttpRpcOrigin,
  gateWsOrigin,
  parseAllowedOrigins,
} from "@kolu/surface/ws-origin";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { appRouter } from "./router";

const PORT = Number(process.env.PORT ?? 7700);
const HOST = process.env.HOST ?? "127.0.0.1";
// CSWSH gate: same-origin always allowed; `ALLOWED_ORIGINS` lists extra
// browser origins for a reverse-proxy front-end. See the upgrade handler.
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const DIST_DIR = process.env.KOLU_SURFACE_EXAMPLE_DIST;

const app = new Hono();

// ── HTTP RPC (mutations + one-shot queries) ───────────────────────────
// biome-ignore lint/suspicious/noExplicitAny: see WsRPCHandler note below
const httpHandler = new RPCHandler(appRouter as any);
app.use("/rpc/*", async (c, next) => {
  // CSWSH gate, HTTP arm — same policy as the `/rpc/ws` upgrade below. The HTTP
  // RPC transport is browser-reachable too (a cross-site `multipart/form-data`
  // POST deserializes into procedure input with no preflight), so the Origin
  // check must run on BOTH transports. See `gateHttpRpcOrigin`.
  const rejected = gateHttpRpcOrigin(c.req.raw, {
    allowedOrigins: ALLOWED_ORIGINS,
  });
  if (rejected) return rejected;
  const { matched, response } = await httpHandler.handle(c.req.raw, {
    prefix: "/rpc",
  });
  if (matched) return response;
  await next();
});

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

// ── WebSocket RPC (streaming subscriptions) ───────────────────────────
const wsHandler = // biome-ignore lint/suspicious/noExplicitAny: appRouter mixes implementSurface's Lazy<Router> spread with hand-listed namespaces; oRPC's RPCHandler input type doesn't accept that union. Runtime shape is a valid router (matches Kolu's own server.ts pattern).
  new WsRPCHandler(appRouter as any);
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (peer) => {
  void wsHandler.upgrade(peer);
});
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/rpc/ws")) {
    // CSWSH gate — reject a cross-site browser Origin before oRPC upgrades.
    if (gateWsOrigin(req, socket, { allowedOrigins: ALLOWED_ORIGINS })) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});
