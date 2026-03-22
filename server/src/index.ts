import { cli } from "cleye";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { WebSocketServer } from "ws";
import { resolve } from "node:path";
import { DEFAULT_PORT } from "kolu-common/config";
import { appRouter } from "./router.ts";
import pkg from "../package.json" with { type: "json" };

const argv = cli({
  name: "kolu",
  version: pkg.version,
  flags: {
    host: {
      type: String,
      description: "Address to listen on",
      default: "0.0.0.0",
    },
    port: {
      type: Number,
      description: "Port to listen on",
      default: DEFAULT_PORT,
    },
  },
  strictFlags: true,
});

const app = new Hono();

// --- oRPC HTTP handler (non-streaming calls) ---
const rpcHandler = new RPCHandler(appRouter);
app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: {},
  });
  if (matched) return response;
  return next();
});

// --- Graceful shutdown logging ---
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => {
    console.log(`[shutdown] received ${sig}, exiting`);
    process.exit(0);
  });
}
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaught exception:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandled rejection:", reason);
  process.exit(1);
});

// --- Health endpoint ---
app.get("/api/health", (c) => c.text("kolu"));

// --- Static files (production) ---
const clientDist = process.env.KOLU_CLIENT_DIST;
if (clientDist) {
  const root = resolve(clientDist);
  app.use("/*", serveStatic({ root }));
  app.get("/*", serveStatic({ root, path: "index.html" }));
}

// --- Start server ---
const { host, port } = argv.flags;
const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(
    `kolu v${pkg.version} listening on http://${info.address}:${info.port}`,
  );
  console.log(
    `[startup] pid=${process.pid} node=${process.version} rss=${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
  );
});

// --- oRPC WebSocket handler (streaming) ---
const wss = new WebSocketServer({ noServer: true });
const wsRpcHandler = new WsRPCHandler(appRouter);

let wsConnections = 0;
wss.on("connection", (ws) => {
  wsConnections++;
  const connId = wsConnections;
  console.log(`[ws] client #${connId} connected (total: ${wss.clients.size})`);
  wsRpcHandler.upgrade(ws, { context: {} });
  ws.on("close", (code, reason) => {
    console.log(
      `[ws] client #${connId} disconnected code=${code} reason=${reason || "none"} (remaining: ${wss.clients.size})`,
    );
  });
  ws.on("error", (err) => {
    console.error(`[ws] client #${connId} error:`, err.message);
  });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  if (url.pathname === "/rpc/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

console.log("oRPC WebSocket ready on /rpc/ws");
