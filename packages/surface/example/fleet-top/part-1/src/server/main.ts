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

import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import {
  type ServableSocket,
  serveSurfaceSocket,
} from "@kolu/surface-app/server";
import { Effect, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { WebSocketServer } from "ws";
import { createTop } from "./top";

const PORT = Number(process.env.PORT ?? 7730);
const HOST = process.env.HOST ?? "127.0.0.1";
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);

const top = createTop();
top.start();

// This part serves NO http routes — vite serves the UI on its own port, and the
// only thing this process answers is the `/rpc/ws` upgrade below. So the router
// layer is empty and every plain request 404s through `HttpRouter`'s own
// `RouteNotFound`. We still own the `http.Server` (rather than letting
// `HttpServer.serve` own the listener) because node fans `upgrade` out to EVERY
// listener, and the ws seam must be the only one.
const server = createServer();
const httpScope = Scope.makeUnsafe();
server.on(
  "request",
  await Effect.runPromise(
    Effect.gen(function* () {
      const httpEffect = yield* HttpRouter.toHttpEffect(Layer.empty);
      return yield* NodeHttpServer.makeHandler(httpEffect, {
        scope: httpScope,
      });
    }).pipe(
      Scope.provide(httpScope),
      Effect.provide(NodeHttpServer.layerHttpServices),
    ),
  ),
);
server.listen({ host: HOST, port: PORT }, () => {
  process.stdout.write(
    `fleet-top part 1 listening on http://${HOST}:${PORT}\n` +
      "  (run `pnpm run dev:client` for the UI on vite's port)\n",
  );
});

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
