import { cli } from "cleye";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { pinoLogger } from "hono-pino";
import { WebSocket as WsClient, WebSocketServer } from "ws";
import { resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { Duplex } from "node:stream";
import { DEFAULT_PORT } from "kolu-common/config";
import { appRouter } from "./router.ts";
import { log } from "./log.ts";
import { initSessionAutoSave } from "./session.ts";
import { snapshotSession } from "./terminals.ts";
import { resolveTlsOptions } from "./tls.ts";
import { configureNixShellEnv } from "./shell.ts";
import { serverHostname } from "./hostname.ts";
import { ensureKoluRoot, shutdownCleanup } from "./koluRoot.ts";
import { startDiagnostics } from "./diagnostics.ts";
import pkg from "../package.json" with { type: "json" };

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

configureNixShellEnv(argv.flags.allowNixShellWithEnvWhitelist);
ensureKoluRoot();
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

// --- Phase 1 preview proxy (#633) ---
// Requests whose Host header looks like `<port>.preview.<anything>` are
// proxied to `127.0.0.1:<port>`. Dev-server preview alongside the terminal
// running it — e.g. `pureintent:7692` serves Kolu, and
// `5173.preview.100-122-32-106.sslip.io:7692` proxies the Vite dev server.
//
// Why subdomain and not path-prefix: Vite/Next/Astro HMR assume absolute
// paths for assets and WebSocket URLs. A path-prefix proxy breaks them; a
// subdomain proxy preserves the illusion of a dedicated origin.
//
// Framing headers (`X-Frame-Options`, CSP `frame-ancestors`) are stripped
// from the upstream response so the iframe can embed the dev server.
// Safe because the proxy only talks to `127.0.0.1` and the browser tile
// already documents that sandbox is relaxed for trusted localhost content.
const PREVIEW_HOST_RE = /^(\d+)\.preview\./;
app.use(async (c, next) => {
  const host = c.req.header("host") ?? "";
  const match = host.match(PREVIEW_HOST_RE);
  if (!match) return next();
  const port = Number(match[1]);
  // Unprivileged port range only. Blocks 0, well-known services (<1024),
  // and bogus values. Stronger SSRF controls (announced-port allowlist)
  // land with Phase 2.
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    return c.text(`preview: invalid port ${match[1]}`, 400);
  }

  const source = new URL(c.req.url);
  const target = `http://127.0.0.1:${port}${source.pathname}${source.search}`;

  // Strip hop-by-hop + the incoming Host; fetch sets its own.
  const upstreamHeaders = new Headers(c.req.raw.headers);
  for (const hdr of [
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
  ]) {
    upstreamHeaders.delete(hdr);
  }
  upstreamHeaders.set("x-forwarded-host", host);
  upstreamHeaders.set("x-forwarded-proto", tlsOptions ? "https" : "http");

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: c.req.method,
      headers: upstreamHeaders,
      body: c.req.raw.body,
      // Node's undici requires duplex: "half" when body is a stream.
      // Without this, fetch throws TypeError for request bodies.
      ...(c.req.raw.body ? { duplex: "half" } : {}),
      redirect: "manual",
    } as RequestInit);
  } catch (err) {
    log.warn({ err, target }, "preview proxy upstream unreachable");
    return c.text(`preview: upstream 127.0.0.1:${port} unreachable`, 502);
  }

  // Remove restrictive framing directives so the iframe embeds cleanly.
  // Dev servers rarely set these, but some middleware stacks do.
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("x-frame-options");
  const csp = responseHeaders.get("content-security-policy");
  if (csp) {
    const cleaned = csp
      .split(";")
      .filter((d) => !/^\s*frame-ancestors\b/i.test(d))
      .join(";")
      .trim();
    if (cleaned === "") responseHeaders.delete("content-security-policy");
    else responseHeaders.set("content-security-policy", cleaned);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
});

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
    startDiagnostics();
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

// --- Phase 1 preview WebSocket passthrough (#633) ---
// Preview subdomains need WS upgrades too — Vite / Next HMR connects back
// to the page's origin for live reload. Dial a client WS to the upstream
// dev server and pipe frames both ways. Separate WebSocketServer instance
// so we don't attach oRPC's connection handler to these sockets.
const previewWss = new WebSocketServer({ noServer: true });

function proxyPreviewWsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  port: number,
): void {
  previewWss.handleUpgrade(req, socket, head, (downstream) => {
    const target = `ws://127.0.0.1:${port}${req.url ?? "/"}`;
    const proto = req.headers["sec-websocket-protocol"];
    const origin = req.headers["origin"];
    const upstream = new WsClient(target, {
      headers: {
        ...(proto && { "sec-websocket-protocol": String(proto) }),
        ...(origin && { origin: String(origin) }),
      },
    });

    // Pipe downstream → upstream once upstream is open. Buffer any frames
    // the browser sends before the upstream handshake completes.
    const pending: Array<{ data: WsClient.RawData; isBinary: boolean }> = [];
    let upstreamOpen = false;

    downstream.on("message", (data, isBinary) => {
      if (upstreamOpen && upstream.readyState === upstream.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else {
        pending.push({ data, isBinary });
      }
    });

    upstream.on("open", () => {
      upstreamOpen = true;
      for (const { data, isBinary } of pending) {
        upstream.send(data, { binary: isBinary });
      }
      pending.length = 0;
    });

    upstream.on("message", (data, isBinary) => {
      if (downstream.readyState === downstream.OPEN) {
        downstream.send(data, { binary: isBinary });
      }
    });

    const closeBoth = (code?: number, reason?: Buffer) => {
      const c = code ?? 1000;
      const r = reason ?? Buffer.from("");
      if (
        downstream.readyState === downstream.OPEN ||
        downstream.readyState === downstream.CONNECTING
      ) {
        downstream.close(c, r);
      }
      if (
        upstream.readyState === upstream.OPEN ||
        upstream.readyState === upstream.CONNECTING
      ) {
        upstream.close(c, r);
      }
    };

    downstream.on("close", (code, reason) => closeBoth(code, reason));
    upstream.on("close", (code, reason) => closeBoth(code, reason));
    downstream.on("error", (err) => {
      log.error({ err, port }, "preview ws downstream error");
      closeBoth(1011);
    });
    upstream.on("error", (err) => {
      log.error({ err, port }, "preview ws upstream error");
      closeBoth(1011);
    });
  });
}

server.on("upgrade", (req, socket, head) => {
  // Preview subdomain takes priority over path-based oRPC WS. Same Host-
  // header pattern as the HTTP proxy middleware — keep the two in sync.
  const host = req.headers.host ?? "";
  const previewMatch = host.match(PREVIEW_HOST_RE);
  if (previewMatch) {
    const previewPort = Number(previewMatch[1]);
    if (
      !Number.isInteger(previewPort) ||
      previewPort < 1024 ||
      previewPort > 65535
    ) {
      socket.destroy();
      return;
    }
    proxyPreviewWsUpgrade(req, socket, head, previewPort);
    return;
  }

  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  if (url.pathname === "/rpc/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});
