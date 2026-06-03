/**
 * Hello-world server for @kolu/surface-app — pure composition, no bespoke glue.
 *
 * The buildInfo cell's server impl is composed from `buildInfoServer()` (commit
 * auto-resolved); `installSurfaceApp` serves the shell fresh + the manifest +
 * the `/sw.js` retirement worker. The example writes no cell store, no `/sw.js`
 * route, and no commit literal. To see skew in dev, boot with
 * `SURFACE_APP_COMMIT=<other>` — a real deploy-simulating override.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { buildInfoServer, installSurfaceApp } from "@kolu/surface-app/server";
import { resolveCommit } from "@kolu/surface-app/vite";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { surface } from "../common/surface.ts";

const PORT = Number(process.env.PORT ?? 7710);
const HOST = process.env.HOST ?? "127.0.0.1";
const DIST_DIR =
  process.env.KOLU_SURFACE_APP_DIST ??
  fileURLToPath(new URL("../../dist", import.meta.url));

// biome-ignore lint/suspicious/noExplicitAny: MemoryPublisher's generic is too strict for our payloads; type safety lives on the typed channels.
const publisher = new MemoryPublisher<Record<string, any>>();

const { router: surfaceRouter } = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),
  // compose the buildInfo impl — commit auto-resolved (env → git → "dev"):
  cells: { ...buildInfoServer() },
});

// biome-ignore lint/suspicious/noExplicitAny: see kolu server.ts — the router fragment's union isn't accepted by RPCHandler's input type; runtime is valid.
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
  // one call: fresh shell + manifest + /sw.js retirement — all from the library.
  installSurfaceApp(app, {
    clientDist: DIST_DIR,
    manifest: { name: "surface-app hello", themeColor: "#6b4eff", icons: [] },
  });
}

const server = serve(
  { fetch: app.fetch, port: PORT, hostname: HOST },
  (info) => {
    console.log(
      `@kolu/surface-app-example on http://${info.address}:${info.port} (server commit ${resolveCommit()})`,
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
