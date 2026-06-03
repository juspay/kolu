/**
 * Hello-world server for @kolu/surface-app.
 *
 * Implements the surface (the `buildInfo` cell reports the server's commit),
 * exposes it over oRPC HTTP + WebSocket, and — when a built client exists —
 * serves it through `installSurfaceApp` so the freshness contract (no-store
 * shell, immutable assets, 404 asset-miss, manifest, /sw.js retirement) is live.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { installSurfaceApp } from "@kolu/surface-app/server";
import { SW_SOURCE } from "@kolu/surface-app";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { surface } from "../common/surface.ts";

const PORT = Number(process.env.PORT ?? 7710);
const HOST = process.env.HOST ?? "127.0.0.1";
// The server's build commit — different from the client's baked value by default
// so the `≠ srv` skew is visible. In a real app the surface-app commit stamp sets it.
const SERVER_COMMIT = process.env.SURFACE_APP_COMMIT ?? "5e2e2bbb";
const DIST_DIR =
  process.env.KOLU_SURFACE_APP_DIST ??
  fileURLToPath(new URL("../../dist", import.meta.url));

// biome-ignore lint/suspicious/noExplicitAny: MemoryPublisher's generic is too
// strict for our payloads; type safety lives on the typed channels.
const publisher = new MemoryPublisher<Record<string, any>>();

const { router: surfaceRouter } = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),
  cells: {
    buildInfo: {
      store: { get: () => ({ commit: SERVER_COMMIT }), set: () => {} },
    },
  },
});

// biome-ignore lint/suspicious/noExplicitAny: see kolu server.ts — the router
// fragment's union isn't accepted by RPCHandler's input type; runtime is valid.
const appRouter = implement(surface.contract).router({
  ...surfaceRouter,
}) as any;

const app = new Hono();

const httpHandler = new RPCHandler(appRouter);
app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await httpHandler.handle(c.req.raw, {
    prefix: "/rpc",
  });
  if (matched) return response;
  await next();
});

if (existsSync(DIST_DIR)) {
  // The self-destructing worker, served no-cache so the browser's update check
  // always re-fetches it (registered before the static catch-all).
  app.get("/sw.js", (c) => {
    c.header("Cache-Control", "no-cache, must-revalidate");
    return c.body(SW_SOURCE, 200, {
      "content-type": "text/javascript; charset=utf-8",
    });
  });
  installSurfaceApp(app, {
    clientDist: DIST_DIR,
    manifest: { name: "surface-app hello", themeColor: "#6b4eff", icons: [] },
  });
}

const server = serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    console.log(
      `@kolu/surface-app-example on http://${info.address}:${info.port} (server commit ${SERVER_COMMIT})`,
    );
    if (!existsSync(DIST_DIR)) {
      console.log(
        "  (no dist yet — run `pnpm build:client`, or start Vite for dev)",
      );
    }
  },
);

const wsHandler = new WsRPCHandler(appRouter);
const wss = new WebSocketServer({ noServer: true });
wss.on("connection", (peer) => {
  void wsHandler.upgrade(peer);
});
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/rpc/ws")) {
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } else {
    socket.destroy();
  }
});
