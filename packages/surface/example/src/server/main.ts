/**
 * Server entry — an `HttpRouter` layer for static assets, a plain `ws` server
 * for the surface.
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
 * otherwise the dev path is "Vite serves the client on its own port, and this
 * server answers only the `/rpc/ws` upgrade" — with no dist there is simply no
 * HTTP route and every request 404s.
 */

import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { NodeHttpServer } from "@effect/platform-node";
import { RPC_MAX_FRAME_BYTES } from "@kolu/surface/frame-limit";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import {
  freshStaticLayer,
  type ServableSocket,
  serveSurfaceSocket,
} from "@kolu/surface-app/server";
import { Effect, Layer, Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { WebSocketServer } from "ws";
import { runtime } from "./serve";

const PORT = Number(process.env.PORT ?? 7700);
const HOST = process.env.HOST ?? "127.0.0.1";
// CSWSH gate: same-origin always allowed; `ALLOWED_ORIGINS` lists extra
// browser origins for a reverse-proxy front-end. See the upgrade handler.
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
const DIST_DIR = process.env.KOLU_SURFACE_EXAMPLE_DIST;

// ── Static client (Nix-build mode) ────────────────────────────────────
// `freshStaticLayer` is the maintained one — Effect's own file engine for the
// bytes (MIME table, byte ranges, root containment) plus surface-app's
// freshness policy: a `no-store` shell, immutable hashed `/assets/*`, and the
// SPA fallback this example used to hand-roll. With no dist the layer is simply
// ABSENT: a missing capability is no route, never a degraded one.
const appLayer =
  DIST_DIR !== undefined && existsSync(DIST_DIR)
    ? freshStaticLayer({ root: DIST_DIR })
    : Layer.empty;

// ── HTTP server ───────────────────────────────────────────────────────
// We own the `http.Server` and hand its `request` event an Effect handler,
// rather than letting `HttpServer.serve` own the listener. That is what leaves
// the `upgrade` event to US (below): node fans an event out to EVERY listener,
// so a second, framework-owned upgrade handler would also try to answer a
// socket we have already upgraded.
const server = createServer();
const httpScope = Scope.makeUnsafe();
server.on(
  "request",
  await Effect.runPromise(
    Effect.gen(function* () {
      const httpEffect = yield* HttpRouter.toHttpEffect(appLayer);
      return yield* NodeHttpServer.makeHandler(httpEffect, {
        scope: httpScope,
      });
    }).pipe(
      Scope.provide(httpScope),
      // The platform services the static layer asks for: file system, path, the
      // file-response platform, ETags.
      Effect.provide(NodeHttpServer.layerHttpServices),
    ),
  ),
);
server.listen({ host: HOST, port: PORT }, () => {
  console.log(`@kolu/surface-example listening on http://${HOST}:${PORT}`);
  if (!DIST_DIR) {
    console.log(
      "  (no KOLU_SURFACE_EXAMPLE_DIST set — start Vite separately for the client)",
    );
  }
});

// ── WebSocket: the surface's one transport ────────────────────────────
const wss = new WebSocketServer({
  noServer: true,
  // The FRAMEWORK's published byte budget, never a guess — and never left to
  // `ws`'s own default either. Unset, `ws` allows 100 MiB while the decoder caps
  // at 16 MiB, so the wire buffers six times what it can ever deliver before
  // answering 1009. `exceedsFrameLimit` polices the same leg for senders; one
  // number, stated here, is what keeps the two ends agreeing.
  maxPayload: RPC_MAX_FRAME_BYTES,
});
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
