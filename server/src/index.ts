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
import { log } from "./log.ts";
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
    log.info({ signal: sig }, "shutdown signal received, exiting");
    process.exit(0);
  });
}
process.on("uncaughtException", (err) => {
  log.fatal({ err }, "uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  log.fatal({ reason }, "unhandled rejection");
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
  log.info(
    {
      version: pkg.version,
      pid: process.pid,
      node: process.version,
      rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
      address: `http://${info.address}:${info.port}`,
    },
    "kolu listening",
  );
});

// --- oRPC WebSocket handler (streaming) ---
const wss = new WebSocketServer({ noServer: true });
const wsRpcHandler = new WsRPCHandler(appRouter);

let wsConnections = 0;
wss.on("connection", (ws) => {
  const connLog = log.child({ ws: ++wsConnections });
  connLog.info({ total: wss.clients.size }, "connected");
  wsRpcHandler.upgrade(ws, { context: {} });
  ws.on("close", (code, reason) => {
    connLog.info(
      {
        code,
        reason: reason.toString() || undefined,
        remaining: wss.clients.size,
      },
      "disconnected",
    );
  });
  ws.on("error", (err) => {
    connLog.error({ err }, "error");
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

log.info("oRPC WebSocket ready on /rpc/ws");
