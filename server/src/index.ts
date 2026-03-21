import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { WebSocketServer } from "ws";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { appRouter } from "./router.ts";

const { values: opts } = parseArgs({
  options: {
    host: { type: "string", default: "0.0.0.0" },
    port: { type: "string", default: "7681" },
  },
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
const port = Number(opts.port);
const server = serve({ fetch: app.fetch, hostname: opts.host, port }, (info) =>
  console.log(`kolu listening on http://${info.address}:${info.port}`),
);

// --- oRPC WebSocket handler (streaming) ---
const wss = new WebSocketServer({ noServer: true });
const wsRpcHandler = new WsRPCHandler(appRouter);

wss.on("connection", (ws) => {
  wsRpcHandler.upgrade(ws, { context: {} });
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
