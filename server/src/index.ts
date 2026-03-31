import { cli } from "cleye";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { pinoLogger } from "hono-pino";
import { WebSocketServer } from "ws";
import { resolve } from "node:path";
import { createServer as createHttpsServer } from "node:https";
import { DEFAULT_PORT } from "kolu-common/config";
import { appRouter } from "./router.ts";
import { log } from "./log.ts";
import { initSessionAutoSave } from "./session.ts";
import { snapshotSession } from "./terminals.ts";
import { resolveTlsOptions } from "./tls.ts";
import { configureNixShellEnv } from "./shell.ts";
import { serverHostname } from "./hostname.ts";
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
    tls: {
      type: Boolean,
      description: "Enable HTTPS with auto-generated self-signed certificate",
      default: false,
    },
    tlsCert: {
      type: String,
      description: "Path to TLS certificate file (PEM)",
    },
    tlsKey: {
      type: String,
      description: "Path to TLS private key file (PEM)",
    },
    verbose: {
      type: Boolean,
      description: "Enable debug-level logging",
      default: false,
    },
    allowNixShellWithEnvWhitelist: {
      type: String,
      description:
        "Allow running inside a nix shell, forwarding only these comma-separated env vars to PTY shells (dev/test only). Uses built-in default list if set to 'default'.",
    },
  },
  strictFlags: true,
});

configureNixShellEnv(argv.flags.allowNixShellWithEnvWhitelist);
initSessionAutoSave(snapshotSession);
if (argv.flags.verbose) log.level = "debug";

const app = new Hono();

// --- HTTP request logging (debug level to avoid noise in normal operation) ---
app.use(
  pinoLogger({
    pino: log,
    http: {
      onReqMessage: false,
      onReqBindings: (c) => ({
        req: { method: c.req.method, url: c.req.path },
      }),
      onResBindings: (c) => ({ res: { status: c.res.status } }),
      onResLevel: () => "debug",
    },
  }),
);

// --- oRPC plugins ---
const rpcPlugins = [
  new LoggingHandlerPlugin({
    logger: log,
    // logRequestResponse left off (default) — too noisy for high-frequency
    // calls like sendInput/attach. Errors and unmatched procedures are
    // still logged automatically by the plugin.
    //
    // logRequestAbort: disabled because the plugin attaches its own
    // addEventListener("abort") on each request signal (independent of our
    // handler code), so every WebSocket disconnect spams one INFO line per
    // in-flight stream. In this app every abort is a tab close — there are
    // no client-initiated cancellations — so the noise has no diagnostic
    // value. The WebSocket close handler below already logs disconnects
    // with connection ID and close code. Trade-off: if a future client-side
    // bug aborts a non-streaming call mid-flight, we won't see it here.
    logRequestAbort: false,
  }),
];

// --- oRPC HTTP handler (non-streaming calls) ---
const rpcHandler = new RPCHandler(appRouter, { plugins: rpcPlugins });
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
    log.info({ signal: sig }, "shutting down");
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

// --- Dynamic PWA manifest (includes hostname) ---
// theme_color must match <meta name="theme-color"> in client/index.html
app.get("/manifest.webmanifest", (c) => {
  const name = `kolu@${serverHostname}`;
  return c.json(
    {
      name,
      short_name: name,
      start_url: "/",
      display: "standalone",
      background_color: "#292c33",
      theme_color: "#292c33",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json" } },
  );
});

// --- Static files (production) ---
const clientDist = process.env.KOLU_CLIENT_DIST;
if (clientDist) {
  const root = resolve(clientDist);
  app.use("/*", serveStatic({ root }));
  app.get("/*", serveStatic({ root, path: "index.html" }));
}

// --- TLS setup ---
const { host, port } = argv.flags;
const tlsOptions = await resolveTlsOptions(argv.flags);

// --- Start server ---
const server = serve(
  {
    fetch: app.fetch,
    hostname: host,
    port,
    ...(tlsOptions && {
      createServer: createHttpsServer,
      serverOptions: tlsOptions,
    }),
  },
  (info) => {
    const protocol = tlsOptions ? "https" : "http";
    log.info(
      {
        version: pkg.version,
        pid: process.pid,
        node: process.version,
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        address: `${protocol}://${info.address}:${info.port}`,
      },
      "kolu listening",
    );
  },
);

// --- oRPC WebSocket handler (streaming) ---
const wss = new WebSocketServer({ noServer: true });
const wsRpcHandler = new WsRPCHandler(appRouter, { plugins: rpcPlugins });

let nextConnId = 0;
wss.on("connection", (ws) => {
  const connId = ++nextConnId;
  const connLog = log.child({ ws: connId });
  connLog.info({ total: wss.clients.size }, "connected");
  wsRpcHandler.upgrade(ws, { context: {} });
  ws.on("close", (code, reason) => {
    const reasonStr = reason.toString();
    connLog.info(
      {
        code,
        ...(reasonStr && { reason: reasonStr }),
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
