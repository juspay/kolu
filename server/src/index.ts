import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { hello } from "kolu-common";
import { spawnPty } from "./pty.ts";
import { handleWs } from "./ws.ts";
import * as path from "node:path";

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Parse CLI args
const args = process.argv.slice(2);
const hostIdx = args.indexOf("--host");
const portIdx = args.indexOf("--port");
const host = hostIdx >= 0 ? args[hostIdx + 1] : "0.0.0.0";
const port = Number(portIdx >= 0 ? args[portIdx + 1] : 7681);

// Spawn single PTY (Phase 1)
const ptyHandle = spawnPty();
console.log(`PTY spawned (pid ${ptyHandle.process.pid})`);

// Health check
app.get("/api/health", (c) => c.text(hello()));

// WebSocket endpoint
app.get(
  "/ws/:terminalId",
  upgradeWebSocket(() => handleWs(ptyHandle)),
);

// Static file serving (production)
const clientDist = process.env.KOLU_CLIENT_DIST;
if (clientDist) {
  // serveStatic root must be relative to CWD, so we compute the relative path
  const relRoot = path.relative(process.cwd(), clientDist);
  app.use("/*", serveStatic({ root: relRoot }));
  // SPA fallback: serve index.html for unmatched routes
  app.get("/*", serveStatic({ root: relRoot, path: "index.html" }));
}

const server = serve({ fetch: app.fetch, hostname: host, port }, (info) => {
  console.log(`kolu server listening on http://${info.address}:${info.port}`);
});

injectWebSocket(server);
