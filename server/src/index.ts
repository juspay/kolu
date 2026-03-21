import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { createTerminalSession, handleWs } from "./terminal.ts";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    host: { type: "string", default: "0.0.0.0" },
    port: { type: "string", default: "7681" },
  },
});

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const handle = createTerminalSession();
console.log(`PTY spawned (pid ${handle.pid})`);

app.get("/api/health", (c) => c.text("kolu"));

app.get(
  "/ws/:terminalId",
  upgradeWebSocket(() => handleWs(handle)),
);

// Serve the built SolidJS client (production only).
// First middleware tries exact file match (JS, CSS, assets).
// Fallback serves index.html for client-side routing (SPA).
const clientDist = process.env.KOLU_CLIENT_DIST;
if (clientDist) {
  const root = resolve(clientDist);
  app.use("/*", serveStatic({ root }));
  app.get("/*", serveStatic({ root, path: "index.html" }));
}

const port = Number(opts.port);
const server = serve({ fetch: app.fetch, hostname: opts.host, port }, (info) =>
  console.log(`kolu listening on http://${info.address}:${info.port}`),
);

injectWebSocket(server);
