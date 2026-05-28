import { createServer as createHttpsServer } from "node:https";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { mountArtifactSdk } from "@kolu/artifact-sdk/server";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { cli } from "cleye";
import { Hono } from "hono";
import { pinoLogger } from "hono-pino";
import { DEFAULT_PORT } from "kolu-common/config";
import { configureNixShellEnv } from "kolu-pty";
import { WebSocketServer } from "ws";
import pkg from "../package.json" with { type: "json" };
import { getCacheControlHeader } from "./cacheControl.ts";
import { startDiagnostics } from "./diagnostics.ts";
import { serverHostname } from "./hostname.ts";
import {
  resolvePreviewPath,
  serveResolvedFile,
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "./iframePreviewRoute.ts";
import { ensureDaemon } from "./daemon/supervisor.ts";
import { ensureKoluRoot, shutdownCleanup } from "./koluRoot.ts";
import { log } from "./log.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { appRouter } from "./router.ts";
import { initSessionAutoSave } from "./session.ts";
import { getTerminal } from "./terminal-registry.ts";
import { reattachLocalTerminals, snapshotSession } from "./terminals.ts";
import { resolveTlsOptions } from "./tls.ts";

const argv = cli({
  name: "kolu",
  version: pkg.version,
  flags: {
    host: {
      type: String,
      description: "Address to listen on",
      default: "127.0.0.1",
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

const PWA_BACKGROUND_COLOR = "#0c0c0e";

configureNixShellEnv(argv.flags.allowNixShellWithEnvWhitelist);
ensureKoluRoot();
initSessionAutoSave(snapshotSession);
if (argv.flags.verbose) log.level = "debug";

// R-4: eagerly spawn the local PTY-host daemon before any client
// connection comes in. The daemon survives kolu-server restart (it's
// detached + unrefd); on every subsequent kolu-server boot the
// supervisor reuses the existing socket. If the daemon hasn't bound
// the socket within 5 s we crash kolu-server — better fail-fast at
// boot than mid-session.
const daemonHandle = await ensureDaemon();
log.info(
  {
    pid: daemonHandle.daemonPid,
    contract: daemonHandle.contractVersion,
    socket: daemonHandle.socketPath,
  },
  "local PTY-host daemon ready",
);
// Reattach to any PTYs the daemon kept alive across our restart, before
// the HTTP listener binds — so they're already in `terminalList` when
// the first client connects (no restore card, terminals just reappear).
const reattached = await reattachLocalTerminals();
if (reattached > 0) {
  log.info({ count: reattached }, "reattached surviving local terminals");
}

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
// appRouter mixes implementSurface's Lazy<Router> spread with
// hand-listed namespaces; oRPC's RPCHandler input type doesn't accept
// that union. The runtime shape is a valid router.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const rpcHandler = new RPCHandler(appRouter as any, { plugins: rpcPlugins });
app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: {},
  });
  if (matched) return response;
  return next();
});

// --- Graceful shutdown ---
// One cleanup registration covers every exit path (signals, fatal
// handlers, natural exit). `process.on('exit', ...)` fires on any call
// to process.exit() and runs synchronously — exactly what rmSync needs.
// Only SIGKILL / power loss bypass it, and XDG logout-wipe is the
// backstop for those.
process.on("exit", shutdownCleanup);

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

// --- Artifact-SDK (comments-on-files) mount ---
// Self-contained — registers the SDK bundle route and a middleware that
// splices the SDK <script> into text/html responses on the iframe-preview
// route. The byte-streaming `iframePreviewRoute` below stays untouched.
mountArtifactSdk(app, {
  sdkScriptPath: "/api/artifact-sdk.js",
  htmlRoutePrefix: `${TERMINAL_FILE_ROUTE_BASE}/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*`,
});

// --- Iframe preview file route ---
// Serves repo files referenced by `FsReadFileOutput.kind === "binary"`.
// URL contract (base + builder + parser) all lives in `iframePreviewRoute.ts`.
// Registered before the static-serve catch-all so production builds don't
// shadow this route with `serveStatic`'s `/*` matcher.
app.get(
  `${TERMINAL_FILE_ROUTE_BASE}/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*`,
  async (c) => {
    const terminalId = c.req.param("terminalId");
    const prefix = `${TERMINAL_FILE_ROUTE_BASE}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/`;
    // Slice the tail off `c.req.path` (Hono applies `decodeURI` here, so
    // `%2f` stays encoded) rather than read `c.req.param("*")` (which
    // applies `decodeURIComponent` — that would decode `%2f` → `/` and
    // destroy segment boundaries before `resolvePreviewPath`'s split
    // could see them, letting `foo%2f..%2fpasswd` through the guard).
    const rawTail = c.req.path.startsWith(prefix)
      ? c.req.path.slice(prefix.length)
      : "";

    const term = getTerminal(terminalId);
    const repoRoot = term?.meta.git?.repoRoot;
    if (!repoRoot) return c.text("terminal has no repo", 404);

    const res = await serveResolvedFile(resolvePreviewPath(repoRoot, rawTail));
    // `Buffer` (subclass of `Uint8Array<ArrayBufferLike>`) is a runtime-valid
    // `BodyInit` but the DOM-typed lib.dom.d.ts narrows `BodyInit` to
    // `Uint8Array<ArrayBuffer>` — the unions don't align in TS even though
    // node-server forwards the buffer unchanged. Cast at the boundary.
    return new Response(res.body as BodyInit, {
      status: res.status,
      headers: res.headers,
    });
  },
);

// --- Dynamic PWA manifest (includes hostname) ---
app.get("/manifest.webmanifest", (c) => {
  const identity = pwaIdentityForHostname(serverHostname);
  return c.json(
    {
      name: identity.name,
      short_name: identity.name,
      start_url: "/",
      display: "standalone",
      background_color: PWA_BACKGROUND_COLOR,
      theme_color: identity.themeColor,
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
  app.use("/*", async (c, next) => {
    const directive = getCacheControlHeader(c.req.path);
    if (directive) c.header("Cache-Control", directive);
    return next();
  });
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
    startDiagnostics();
  },
);

// --- oRPC WebSocket handler (streaming) ---
const wss = new WebSocketServer({ noServer: true });
// biome-ignore lint/suspicious/noExplicitAny: see RPCHandler comment above
const wsRpcHandler = new WsRPCHandler(appRouter as any, {
  plugins: rpcPlugins,
});

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
