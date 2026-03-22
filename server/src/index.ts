import { defineCommand, runMain, showUsage } from "citty";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { WebSocketServer } from "ws";
import { resolve } from "node:path";
import { appRouter } from "./router.ts";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const main = defineCommand({
  meta: {
    name: "kolu",
    version: pkg.version,
    description: "Web-based terminal multiplexer",
  },
  args: {
    host: {
      type: "string",
      default: "0.0.0.0",
      description: "Address to listen on",
    },
    port: {
      type: "string",
      default: "7681",
      description: "Port to listen on",
    },
  },
  run({ args }) {
    startServer(args.host, Number(args.port));
  },
});

// Reject unknown flags (citty silently ignores them)
const knownFlags = new Set([
  "--host",
  "--port",
  "--help",
  "-h",
  "--version",
  "-v",
]);
const unknownFlag = process.argv
  .slice(2)
  .find((a) => a.startsWith("-") && !knownFlags.has(a.split("=")[0]!));
if (unknownFlag) {
  console.error(`Unknown option: ${unknownFlag}\n`);
  await showUsage(main);
  process.exit(1);
}

runMain(main);

function startServer(host: string, port: number) {
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
  const server = serve({ fetch: app.fetch, hostname: host, port }, (info) =>
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
}
