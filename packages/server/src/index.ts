import type { IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { serve } from "@hono/node-server";
import { mountArtifactSdk } from "@kolu/artifact-sdk/server";
import { getPtyHostSocketPath } from "@kolu/pty-host";
import { createDirServer } from "@kolu/serve-dir";
import {
  gateStaleSocket,
  installFreshStatic,
  installPwaManifest,
  startWsHeartbeat,
} from "@kolu/surface-app/server";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { cli } from "cleye";
import { Hono } from "hono";
import { pinoLogger } from "hono-pino";
import { DEFAULT_PORT } from "kolu-common/config";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import { configureNixShellEnv } from "kolu-pty";
import { type WebSocket, WebSocketServer } from "ws";
import { startDiagnostics } from "./diagnostics.ts";
import { serverHostname, serverProcessId, serverVersion } from "./hostname.ts";
import {
  previewRealpathGuard,
  previewTailFromRawUrl,
  rawTargetFromContext,
} from "./iframePreviewRoute.ts";
import { ensureKoluRoot, shutdownCleanup } from "./koluRoot.ts";
import { log } from "./log.ts";
import { ensureLocalEndpoint } from "./ptyHost/endpoint.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { appRouter } from "./router.ts";
import { initSessionAutoSave } from "./session.ts";
import { surfaceCtx } from "./surfaceCtx.ts";
import { getTerminal } from "./terminal-registry.ts";
import { attachLocalPtyHost } from "./terminalBackend/local.ts";
import { snapshotSession } from "./terminals.ts";
import { resolveTlsOptions } from "./tls.ts";

const argv = cli({
  name: "kolu",
  version: serverVersion,
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
    ptyHostSocket: {
      type: String,
      description:
        "Path for the pty-host unix socket that kolu-tui connects to (default $XDG_RUNTIME_DIR/kolu/pty-host.sock).",
    },
  },
  strictFlags: true,
});

const PWA_BACKGROUND_COLOR = "#0c0c0e";

configureNixShellEnv(argv.flags.allowNixShellWithEnvWhitelist);
ensureKoluRoot();
initSessionAutoSave(snapshotSession);
if (argv.flags.verbose) log.level = "debug";

// ── The one-way door: the surviving pty-host daemon ──────────────────────
// The composition root. The PTYs no longer live in this process; the daemon
// owns them across our restarts. Spawn-or-recycle it, connect a socket-backed
// client, and inject that into the local backend — all BEFORE the server starts
// accepting RPCs, so the first terminal op has a live client. The daemon also
// serves this socket to kolu-tui (the role kolu-server used to play in-process).
//
// B1 boot policy is *always recycle, survival off*: a daemon surviving from a
// prior server is killed and respawned, so user-facing semantics stay identical
// to today (a deploy recycles terminals) while every deploy soaks the
// kill→waitForPidGone→respawn race with zero sessions at stake. Survival proper
// (adopt-by-id) is B2.
const ptyHostEndpoint = await ensureLocalEndpoint({
  socketPath: getPtyHostSocketPath(argv.flags.ptyHostSocket),
  log,
  publishStatus: (status) => surfaceCtx.cells.daemonStatus.set(status),
});
attachLocalPtyHost(ptyHostEndpoint.client);
// Drop our client on exit — the daemon SURVIVES us (the whole point), so this
// does not kill it.
process.on("exit", () => ptyHostEndpoint.dispose());

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
  // Deliberately fatal — same as an uncaught exception. A floating promise
  // is as corrupting as a sync throw, and a context-free global handler is
  // the wrong place to make a recover-or-die call (per-task error boundaries
  // own that; see the provider DAG). If this fires, a background task is
  // missing its boundary — fix the source, don't soften the net. The
  // supervisor (systemd `Restart=on-failure` / launchd) restarts clean.
  log.fatal(
    { reason },
    "unhandled rejection — a background task is missing its error boundary",
  );
  process.exit(1);
});

// --- Health endpoint ---
app.get("/api/health", (c) => c.text("kolu"));

// --- Artifact-SDK (comments-on-files) mount ---
// Self-contained — registers the SDK bundle route and a middleware that
// splices the SDK <script> into text/html responses on the iframe-preview
// route. The byte-streaming `iframePreviewRoute` below stays untouched.
const PREVIEW_ROUTE_PATTERN = `${TERMINAL_FILE_ROUTE_BASE}/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*`;
mountArtifactSdk(app, {
  sdkScriptPath: "/api/artifact-sdk.js",
  htmlRoutePrefix: PREVIEW_ROUTE_PATTERN,
});

// --- Iframe preview file route ---
// Serves repo files referenced by `FsReadFileOutput.kind === "binary"`.
// URL contract (base + builder + parser) all lives in `iframePreviewRoute.ts`.
// Registered before the static-serve catch-all so production builds don't
// shadow this route with `serveStatic`'s `/*` matcher.
app.get(PREVIEW_ROUTE_PATTERN, async (c) => {
  const terminalId = c.req.param("terminalId");
  // Slice the tail off the RAW request target — NOT `c.req.path` (`decodeURI`d),
  // `c.req.param("*")` (`decodeURIComponent`d), OR `c.req.raw.url`. The first two
  // decode the tail before `@kolu/serve-dir` decodes again (double-decode). The
  // last is built by @hono/node-server as `new URL(...).href`, which has ALREADY
  // run WHATWG path normalization — collapsing `foo/../secret` and `foo/%2e%2e/`
  // to `secret` BEFORE the handler sees it, defeating serve-dir's `..` guard. The
  // Node `IncomingMessage.url` (`c.env.incoming.url`) is the raw, un-normalized
  // request target (origin-form `/path?query`); that's what serve-dir must see.
  // `previewTailFromRawUrl` documents the rest (correctness for `%`-bearing
  // names + `%2f` traversal defense) and is unit-tested in
  // `iframePreviewRoute.test.ts`. `rawTargetFromContext` owns the raw-target
  // selection (`incoming.url`) as one shipped adapter the integration test
  // drives too, so the two halves of this guard can't drift. It reads `c.env`
  // as `Partial<HttpBindings>` so the @hono/node-server binding doesn't leak
  // into the other mounts' `Hono<BlankEnv>` expectations. When `incoming` is
  // absent it returns `undefined` — a fail-CLOSED 500 here, NOT a silent
  // fallback to the WHATWG-normalized `c.req.raw.url` that would defeat the `..`
  // guard. Kolu's only production adapter (@hono/node-server) always supplies
  // `incoming`, so this arm signals a genuinely broken host, not a degraded one.
  const rawTarget = rawTargetFromContext(c);
  if (rawTarget === undefined)
    return c.text("raw request target unavailable", 500);
  const rawTail = previewTailFromRawUrl(rawTarget, terminalId);

  // The one kolu binding: which directory this terminal serves. Kept as the
  // git repo root for now (behavior-preserving — the browse tree, git-status
  // decoration, and diff are all repo-relative); switching the injected root
  // to the terminal's `$PWD` (`meta.cwd`) is a one-line change here, deferred
  // because it's a browse-model/decoration product decision, not this refactor.
  const root = getTerminal(terminalId)?.meta.git?.repoRoot;
  if (!root) return c.text("terminal has no repo", 404);

  // The agnostic receptacle owns range/content-type/the lexical guard and
  // returns a Fetch `Response`; the artifact-sdk HTML decorator (mounted
  // above) rewrites it downstream for text/html. Range header is read from the
  // request inside. We inject kolu's realpath guard (`previewRealpathGuard`)
  // so a repo-local symlink escaping the root (`leak.html -> /etc/passwd`) is
  // rejected with 403 before any byte is read — the stage the lexical guard
  // inside `@kolu/serve-dir` can't cover.
  return createDirServer(root, previewRealpathGuard(root)).fetch(
    rawTail,
    c.req.raw,
  );
});

// --- Dynamic PWA manifest (includes hostname) ---
// surface-app owns assembly + the install-friendly defaults (start_url,
// display); kolu supplies the per-host branding. Served unconditionally — in
// dev the Vite proxy forwards `/manifest.webmanifest` here, so it must exist
// without a built client.
const pwaIdentity = pwaIdentityForHostname(serverHostname);
installPwaManifest(app, {
  name: pwaIdentity.name,
  short_name: "kolu",
  // `...extra` passthrough in installPwaManifest carries these through to the
  // served manifest — they upgrade Chromium's native install card (and the
  // pwa-install preview) from a bare icon to a richer app entry.
  description:
    "Real terminals on an infinite canvas — run any coding agent, pin it as an app, reach it from anywhere.",
  themeColor: pwaIdentity.themeColor,
  backgroundColor: PWA_BACKGROUND_COLOR,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    // Maskable variant (logo inside the safe zone on the brand background) so
    // installed icons fill the OS mask instead of being letterboxed.
    {
      src: "/icon-512-maskable.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  // No `screenshots`: they only prettify the install card (install works without
  // them), and committed product shots go stale as the UI moves. Not worth the
  // maintenance — the icon + description carry the install entry.
});

// --- Static files (production) ---
// surface-app's freshness contract on the wire: no-store shell, immutable
// hashed `/assets/*`, 404 on an asset miss (never the HTML shell), the `/sw.js`
// worker, and the SPA fallback. Replaces kolu's hand-rolled cache-control +
// static-serve block. `serviceWorker: "notify"` serves the fetch-less
// notification worker (kolu fires agent-finished alerts via
// `ServiceWorkerRegistration.showNotification()`, the only notification path
// that works in an installed PWA) instead of the self-destructing one — it never
// caches, so the freshness contract still holds. Pairs with
// `registerServiceWorker()` in the client's `index.tsx`.
const clientDist = process.env.KOLU_CLIENT_DIST;
if (clientDist) {
  installFreshStatic(app, { root: clientDist, serviceWorker: "notify" });
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
        version: serverVersion,
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
// Liveness heartbeat: ping accepted sockets and terminate any that stop ponging,
// reaping the server-side zombie (and its stream subscriptions) a half-open
// client would otherwise leak. The client half (`createHeartbeat`) un-freezes
// the tab; this half frees the server. Stale tabs are closed before the oRPC
// upgrade and never register (the ws upgrade has already accepted them), so
// #1231's gate is untouched.
const heartbeat = startWsHeartbeat(wss);

let nextConnId = 0;
wss.on("connection", (ws: WebSocket, _req: IncomingMessage, url: URL) => {
  const connId = ++nextConnId;
  const connLog = log.child({ ws: connId });

  // Stale-tab handshake gate (`@kolu/surface-app/server`): installs the `error`
  // handler in the correct order, reads the `pid` echo off the URL, and closes a
  // stale tab — one bound to a PREVIOUS instance — BEFORE oRPC upgrades the
  // socket, so dead-terminal stream subscriptions never replay and storm the logs
  // with NOT_FOUND. An absent `pid` (the first-ever connect) always passes. The
  // ordering + close are the library's so kolu never re-derives them;
  // `serverProcessId` is the same id the `identity.info` probe reports.
  if (
    gateStaleSocket(ws, url, serverProcessId, {
      onError: (err) => connLog.error({ err }, "error"),
      onReject: (claimedPid) =>
        connLog.info(
          { claimedPid, serverProcessId },
          "rejecting stale client — server restarted since it last connected",
        ),
    })
  ) {
    return;
  }

  connLog.info({ total: wss.clients.size }, "connected");
  // Accepted socket: enrol it in the liveness heartbeat (its `pong` keeps it
  // alive; a missed ping terminates it) so a half-open client is reaped here.
  heartbeat.register(ws);
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
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  if (url.pathname === "/rpc/ws") {
    // Pass the pre-parsed `url` as a 3rd arg so the connection handler reads
    // `pid` without re-parsing `req.url`.
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, url);
    });
  } else {
    socket.destroy();
  }
});

// The pty-host unix socket (for kolu-tui) is served by the DAEMON now, not here —
// see the composition root above. kolu-tui dials the same path unchanged.
