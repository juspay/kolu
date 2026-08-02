/**
 * The second link: a WebSocket server.
 *
 * The exact same `createTop()` engine — the same `{ group, handlers }` pair —
 * now served over the wire instead of consumed in-process. Effect RPC speaks
 * ndjson over ONE bidirectional transport, so browser ↔ server is a single
 * WebSocket: subscriptions and imperative calls alike ride it, and
 * `serveSurfaceSocket` stands a per-connection RPC server over the shared
 * handlers. The client swaps `directDispatch` for `websocketLink` and nothing
 * else changes.
 *
 * No auth, no HTTPS — just enough wiring to demonstrate the framework
 * end-to-end. The CSWSH origin gate runs on the ws upgrade, which is now the
 * only browser-reachable RPC entry point.
 */

import { serve } from "@hono/node-server";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import {
  type ServableSocket,
  serveSurfaceSocket,
} from "@kolu/surface-app/server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { createTop } from "./top";

const PORT = Number(process.env.PORT ?? 7730);
const HOST = process.env.HOST ?? "127.0.0.1";
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

const top = createTop();
top.start();

const app = new Hono();

const server = serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    process.stdout.write(
      `fleet-top part 1 listening on http://${info.address}:${info.port}\n` +
        "  (run `pnpm run dev:client` for the UI on vite's port)\n",
    );
  },
);

// ── WebSocket: the surface's one transport ─────────────────────────────
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 8 * 1024 * 1024,
});
wss.on("connection", (peer) => {
  const serving = serveSurfaceSocket({
    group: top.runtime.group,
    handlers: top.runtime.handlers,
    // `ws`'s socket satisfies `ServableSocket` structurally; its typings narrow
    // `addEventListener` per event name, which the generic seam does not.
    socket: peer as unknown as ServableSocket,
  });
  // A serving site OWNS `done`: it resolves when the peer hangs up and REJECTS
  // if the serving stack itself failed. Observe it, or a dead connection dies
  // silently.
  serving.done.catch((err) => {
    process.stderr.write(`[ws] connection failed: ${String(err)}\n`);
  });
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
