import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import { spawnPty } from "./pty.ts";
import { handleWs } from "./ws.ts";
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

const ptyHandle = spawnPty();
console.log(`PTY spawned (pid ${ptyHandle.process.pid})`);

app.get("/api/health", (c) => c.text("kolu"));

app.get(
  "/ws/:terminalId",
  upgradeWebSocket(() => handleWs(ptyHandle)),
);

// Static file serving (production)
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
