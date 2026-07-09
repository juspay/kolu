/**
 * The second link: a WebSocket server.
 *
 * The exact same `createTop()` engine — the same flattened router — now served
 * over the wire instead of consumed in-process. Browser ↔ server is oRPC over a
 * WebSocket (`@orpc/server/ws`) for streaming subscriptions, plus an HTTP arm
 * (`@orpc/server/fetch`) for one-shot procedure calls. The client swaps
 * `directLink` for `websocketLink` and nothing else changes.
 *
 * No auth, no HTTPS — just enough wiring to demonstrate the framework
 * end-to-end. The CSWSH origin gate runs on BOTH transports (a cross-site POST
 * reaches the HTTP RPC arm too, not just the ws upgrade).
 */

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
import { createTop } from "./top";

const PORT = Number(process.env.PORT ?? 7730);
const HOST = process.env.HOST ?? "127.0.0.1";
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

const top = createTop();
top.start();

const app = new Hono();

// ── HTTP RPC (one-shot procedure calls, e.g. process.kill) ──────────────
// biome-ignore lint/suspicious/noExplicitAny: RPCHandler's router input type doesn't accept implementSurface's Lazy<Router> spread; the runtime shape is a valid router.
const httpHandler = new RPCHandler(top.router as any);
app.use("/rpc/*", async (c, next) => {
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

const server = serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    process.stdout.write(
      `fleet-top part 1 listening on http://${info.address}:${info.port}\n` +
        "  (run `pnpm run dev:client` for the UI on vite's port)\n",
    );
  },
);

// ── WebSocket RPC (streaming cell / collection subscriptions) ───────────
// biome-ignore lint/suspicious/noExplicitAny: same Lazy<Router> spread typing dance as the HTTP handler above.
const wsHandler = new WsRPCHandler(top.router as any);
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 8 * 1024 * 1024,
});
wss.on("connection", (peer) => {
  void wsHandler.upgrade(peer);
});
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/rpc/ws")) {
    if (gateWsOrigin(req, socket, { allowedOrigins: ALLOWED_ORIGINS })) return;
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } else {
    socket.destroy();
  }
});

const shutdown = (): void => {
  top.dispose();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
