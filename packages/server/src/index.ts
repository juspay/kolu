import type { IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { serve } from "@hono/node-server";
import { mountArtifactSdk } from "@kolu/artifact-sdk/server";
import { startHeapDiagnostics } from "@kolu/heap-diag";
// The web shell reaches the terminal domain ONLY through @kolu/padi's published
// entry points (the package-boundary seal). Post-cutover it keeps just the
// streaming preview read (`previewFile`, for the iframe binary route) and its own
// publisher size (a diagnostic); it no longer runs the terminal domain.
import {
  discoverPadiDaemons,
  padiKavalSocketPath,
  padiSocketPath,
  previewFile,
  publisherSize,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
import { discoverKavalDaemons } from "kaval";
import {
  PADI_FORWARDING_POLICY,
  type PadiProcessMemory,
  padiSurface,
} from "@kolu/padi/surface";
import {
  gateHttpRpcOrigin,
  gateWsOrigin,
  parseAllowedOrigins,
} from "@kolu/surface/ws-origin";
import {
  acceptSurfaceSocket,
  installFreshStatic,
  installPwaManifest,
} from "@kolu/surface-app/server";
import { reServeSurface } from "@kolu/surface-nix-host";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { cli } from "cleye";
import { Hono } from "hono";
import { pinoLogger } from "hono-pino";
import { getPendingSummaryFetches } from "kolu-claude-code";
import { DEFAULT_PORT } from "kolu-common/config";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import { type WebSocket, WebSocketServer } from "ws";
import {
  serverHostname,
  serverProcessId,
  serverStartedAt,
  serverVersion,
} from "./hostname.ts";
import {
  previewTailFromRawUrl,
  rawTargetFromContext,
} from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import {
  probeKavalStatus,
  startDaemonInventorySampler,
} from "./daemonInventory.ts";
import { liveSamplerDeps, startMemorySampler } from "./memorySampler.ts";
import { ensurePadiBinding } from "./padiBinding.ts";
import { mapConnectionToPadiLink } from "./padiLink.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { buildAppRouter } from "./router.ts";
import { koluSurfaceCtx, koluSurfaceRouter } from "./surface.ts";
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
  },
  strictFlags: true,
});

const PWA_BACKGROUND_COLOR = "#0c0c0e";

// CSWSH defense: extra browser origins (beyond same-origin) allowed to reach
// the unauthenticated RPC surface — on BOTH transports, the `/rpc/ws` upgrade
// and the `/rpc/*` HTTP handler. Empty by default — loopback + same-origin is
// the common case; set `KOLU_ALLOWED_ORIGINS` (comma-separated) for a
// reverse-proxy / `tailscale serve` front-end whose browser origin differs
// from the `Host` it forwards. See `gateWsOrigin` / `gateHttpRpcOrigin` below.
const allowedOrigins = parseAllowedOrigins(process.env.KOLU_ALLOWED_ORIGINS);

// `--verbose` drops the server's logger to debug. padi runs in its OWN process
// now: its daemon-spine stderr logger emits every level unconditionally, but its
// DOMAIN code logs through `@kolu/padi`'s own pino logger (`packages/padi/src/log.ts`),
// which filters at `LOG_LEVEL ?? "info"`. So `--verbose` alone would leave padi's
// domain debug lines dropped (the split-process regression the pre-cutover
// `padiLog.level = "debug"` guarded against). We forward the intent instead: the
// binding launches padi with `LOG_LEVEL=debug` when verbose (see `daemonEnv` in
// `padiBinding.ts`), the cross-process twin of raising that logger in place.
if (argv.flags.verbose) {
  log.level = "debug";
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

// --- Graceful shutdown ---
// Signals map to a clean exit; the fatal handlers make a floating promise or a
// sync throw as terminal as each other (the supervisor restarts clean). There is
// NO on-exit scratch cleanup here anymore: the per-process scratch dir moved into
// the padi process (padi owns `ensureKoluRoot`/`shutdownCleanup` under its
// state-root), so kolu-server has nothing to wipe.
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
    // with connection ID and close code.
    logRequestAbort: false,
  }),
];

// ─────────────────────────────────────────────────────────────────────────────
// ASYNC BOOT — bind the padi PROCESS, re-serve its surface, assemble the router.
//
// The cutover replaces the in-process padi (and its kaval endpoint) with a bound
// padi PROCESS. `ensurePadiBinding` spawns/adopts padi and hands back a
// reconnect-mirror session; `reServeSurface` mirrors `padiSurface` (per its
// forwarding policy) onto a per-binding router. That router is spliced under the
// `padi` key beside kolu-server's own `kolu`+`surfaceApp` fragment, so the browser
// reaches padi's members at `/surface/padi/*`.
//
// Awaited BEFORE the HTTP server listens (as `ensureLocalEndpoint` was) so no RPC
// races an unready binding; a boot failure reports the down state through the
// re-serve's `connection` cell rather than crashing (fail-open).
// ─────────────────────────────────────────────────────────────────────────────
const padiSession = await ensurePadiBinding({
  // The nix-shell env whitelist rides padi's CLI flag (kolu-server no longer
  // spawns PTYs — padi's kaval does — so `configureNixShellEnv` is FORWARDED to
  // padi, not called here).
  nixShellWhitelist: argv.flags.allowNixShellWithEnvWhitelist,
  // Forward the kolu app version so spawned PTYs' `TERM_PROGRAM_VERSION` stays the
  // kolu app version (byte-identical to the pre-cutover in-process spawn), not
  // padi's own commit hash. padi stamps this via its `--spawn-version` flag.
  spawnVersion: serverVersion,
  // Forward `--verbose` to padi's process (as `LOG_LEVEL=debug`) so its OWN pino
  // domain logger emits debug — the split-process twin of the pre-cutover
  // `padiLog.level = "debug"`.
  verbose: argv.flags.verbose,
});

// Pin the contract type param explicitly: `padiSession` is a concrete
// `PadiBindingSession` (a class implementing `RemoteMirrorSession<padi contract>`),
// and the pump's `session: RemoteMirrorSession<C>` param can't reverse-infer `C`
// from a class value (it hides inside the mapped `AgentClient<C>`). Naming the
// contract here plugs `padiSession` in checked — the old `as unknown as
// HostSession<…>` double-cast is gone.
const reServedPadi = reServeSurface<
  typeof padiSurface.spec,
  typeof padiSurface.contract
>({
  source: padiSurface, // the BASE surface; reServeSurface adds `connection` internally.
  policy: PADI_FORWARDING_POLICY, // per-member value|delta forwarding.
  session: padiSession,
  log: (line) => log.debug({ line }, "padi re-serve"),
});

// `done` must never float (#1661 candidate 9): it settles on a clean session
// destroy, or REJECTS on a terminal mirror fault (a SinkError / client mismatch)
// that STOPS the pump — after which the internal `connection` cell is frozen at a
// stale-but-healthy value. Fail LOUD (fail-fast per the design philosophy); the
// supervisor restarts kolu-server clean.
reServedPadi.done
  .then(() => log.info({}, "padi re-serve pump exited (session destroyed)"))
  .catch((err) => {
    log.fatal({ err }, "padi re-serve pump died — binding is unrecoverable");
    process.exit(1);
  });

// Splice the re-serve's INNER surface object under the `padi` key beside
// kolu-server's own siblings. The re-serve router is a top-level single-surface
// router (`{ surface: { <padi members>, connection } }`), so nesting its `.surface`
// under `padi` yields `/surface/padi/<member>` with no `surface/surface` double
// prefix (proved empirically by the padiBinding integration test).
const surfaceRouter = {
  surface: {
    ...koluSurfaceRouter.surface,
    padi: (reServedPadi.router as { surface: Record<string, unknown> }).surface,
  },
};

const appRouter = buildAppRouter({
  surfaceRouter,
  // The re-targeted "restart": drain the bound padi (persist + exit; kaval + its
  // PTYs survive; the reconnect loop re-spawns padi). Never a kill-9.
  drainBoundPadi: () => padiSession.drainBoundPadi(),
});

// --- oRPC handlers (HTTP non-streaming + WS streaming) ---
// appRouter mixes implementSurface's Lazy<Router> spread with hand-listed
// namespaces; oRPC's RPCHandler input type doesn't accept that union. The
// runtime shape is a valid router.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
const rpcHandler = new RPCHandler(appRouter as any, { plugins: rpcPlugins });
// biome-ignore lint/suspicious/noExplicitAny: see RPCHandler comment above
const wsRpcHandler = new WsRPCHandler(appRouter as any, {
  plugins: rpcPlugins,
});

// --- oRPC HTTP handler mount (non-streaming calls) ---
app.use("/rpc/*", async (c, next) => {
  // CSWSH gate, HTTP arm: the WebSocket upgrade is NOT the only browser path
  // into the unauthenticated RPC surface. The oRPC HTTP codec deserializes a
  // cross-site `multipart/form-data` POST (a CORS-"simple" request, no
  // preflight) straight into procedure input, and no-input mutations
  // (`daemon.restart`) need no body at all — so a page the operator visits could
  // drive these over plain HTTP even with `/rpc/ws` gated. Reject a cross-site
  // browser Origin here too, with the SAME policy. Non-browser clients (no
  // Origin) and same host:port traffic pass; kolu's own UI never uses this
  // transport (it drives every call over `/rpc/ws`).
  const rejected = gateHttpRpcOrigin(c.req.raw, {
    allowedOrigins,
    onReject: (origin) =>
      log.warn({ origin }, "rejecting HTTP RPC: disallowed Origin"),
  });
  if (rejected) return rejected;
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: {},
  });
  if (matched) return response;
  return next();
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
  // drives too, so the two halves of this guard can't drift. When `incoming` is
  // absent it returns `undefined` — a fail-CLOSED 500 here, NOT a silent fallback
  // to the WHATWG-normalized `c.req.raw.url` that would defeat the `..` guard.
  const rawTarget = rawTargetFromContext(c);
  if (rawTarget === undefined)
    return c.text("raw request target unavailable", 500);
  const rawTail = previewTailFromRawUrl(rawTarget, terminalId);

  // Which directory this terminal serves (its git repo root) — RE-SOURCED from
  // padi's registry over the bound session, since padi (not kolu-server) owns the
  // terminal registry now. padi resolves terminal id → repoRoot; kolu-server then
  // STREAMS the file itself via the shared `previewFile` (bounded heap, forwarding
  // the browser's `Range` so a `<video>` seek answers 206), exactly as the retired
  // in-process route did — so a multi-GB video is never forced whole through a
  // base64 procedure.
  const clientPromise = padiSession.currentClient();
  if (!clientPromise) return c.text("padi is not connected", 503);
  let repoRoot: string | null;
  try {
    const client = await clientPromise;
    ({ repoRoot } = await client.surface.preview.repoRootForTerminal({
      terminalId,
    }));
  } catch (err) {
    // padi's `repoRootForTerminal` returns `{ repoRoot: null }` for an
    // unknown/unmapped terminal — it never THROWS for the no-repo case (that is
    // the `if (!repoRoot)` 404 below). So a thrown error here is an OPERATIONAL
    // failure of the bound link (padi went down mid-read, a protocol error, an
    // unexpected handler fault), NOT "no repo". Surface it as a 503 so the real
    // fault is visible instead of masqueraded as an ordinary missing-file 404.
    log.error({ err, terminalId }, "padi repoRoot resolve failed (link fault)");
    return c.text("padi link fault resolving terminal repo", 503);
  }
  if (!repoRoot) return c.text("terminal has no repo", 404);

  // The SAME serve-dir read + realpath guard `padiSurface.preview.read` serves,
  // but the STREAMING form: a `ReadableStream` body on 2xx (disk→socket, bounded
  // heap), the browser's `Range` forwarded (206 on a `<video>` seek), and the
  // symlink-escape 403 re-enforced before any byte is read. The artifact-sdk HTML
  // decorator (mounted above) rewrites text/html downstream.
  const r = await previewFile({
    repoPath: repoRoot,
    filePath: rawTail,
    range: c.req.header("range"),
  });
  return new Response(r.body as BodyInit, {
    status: r.status,
    headers: r.headers,
  });
});

// --- Dynamic PWA manifest (includes hostname) ---
// surface-app owns assembly + the install-friendly defaults (start_url,
// display); kolu supplies the per-host branding. Served unconditionally — in
// dev the Vite proxy forwards `/manifest.webmanifest` here, so it must exist
// without a built client.
const pwaIdentity = pwaIdentityForHostname(serverHostname);
installPwaManifest(app, {
  name: pwaIdentity.name,
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
// worker, and the SPA fallback. `serviceWorker: "notify"` serves the fetch-less
// notification worker (kolu fires agent-finished alerts via
// `ServiceWorkerRegistration.showNotification()`, the only notification path
// that works in an installed PWA). Pairs with `registerServiceWorker()` in the
// client's `index.tsx`.
const clientDist = process.env.KOLU_CLIENT_DIST;
if (clientDist) {
  installFreshStatic(app, { root: clientDist, serviceWorker: "notify" });
}

// The reading returned when padi is BELIEVED up (a live bound client) yet its
// memory read fails — a link drop mid-read, a schema/protocol fault, an empty
// subscription. Both processes fold to the honest `error` (not `absent`): padi's
// `ProcessRss` schema keeps `error` distinct from `absent` precisely so a failed
// read never renders identically to "no process to measure" (the
// `caught-error-must-not-collapse-to-empty` rule). `absent` is reserved for the
// true no-client case (padi genuinely down), returned as `null` below.
const PADI_MEMORY_READ_ERROR: PadiProcessMemory = {
  padi: { status: "error" },
  kaval: { status: "error" },
};

// Read padi's `{ padi, kaval }` memory pair off the bound session — a one-shot
// read of padi's `processMemory` cell (a snapshot-first subscription; take the
// first frame — padi's last published value — and stop). Returns `null` ONLY when
// padi is down (no live client), so the fold reports padi + kaval as the honest
// `absent`, never a fake zero; a read that FAILS through a live client returns the
// `error` reading instead (never `null`), so a real anomaly stays distinct from
// `absent`. kaval runs inside the padi process now, so padi (not kolu-server) is the
// source of that pair; the sampler folds it in below.
async function readPadiMemoryOnce(): Promise<PadiProcessMemory | null> {
  const clientPromise = padiSession.currentClient();
  if (!clientPromise) return null;
  const ctl = new AbortController();
  try {
    // `currentClient()` already returns the typed `PadiSurfaceClient`, so the cell
    // verb is reachable checked — no structural retype needed.
    const client = await clientPromise;
    const iterable = await client.surface.processMemory.get(
      {},
      { signal: ctl.signal },
    );
    for await (const frame of iterable) return frame;
    // The client was live but the cell yielded no frame — an operational anomaly,
    // not "no process to measure". Report `error`, not `absent`, and log at `error`
    // (a live-client read that produced nothing is a failed read, not a degraded-but-
    // recoverable state — see `.agency/code-police.md` errors-must-log-at-error).
    log.error({}, "padi memory read yielded no frame through a live client");
    return PADI_MEMORY_READ_ERROR;
  } catch (err) {
    // padi was BELIEVED up (a live client) yet the read threw — surface the honest
    // `error` state, distinct from `absent`, rather than collapsing a caught error
    // to the empty "no process" reading. padi's liveness still rides the re-serve's
    // own `connection` cell; this only affects the memory rail's three-way readout.
    // A caught read failure is a real error, not `warn` (errors-must-log-at-error).
    log.error({ err }, "padi memory read failed through a live client");
    return PADI_MEMORY_READ_ERROR;
  } finally {
    ctl.abort();
  }
}

// Feed the chrome bar's memory readout: sample kolu-server's OWN RSS on a fixed
// cadence, fold in padi's `{ padi, kaval }` reading, and publish all three on the
// `processMemory` cell (the client adds its own JS heap locally). kaval runs inside
// the padi process now, so its RSS rides padi's readout, folded in here.
startMemorySampler(
  liveSamplerDeps({
    publish: (m) => koluSurfaceCtx.cells.processMemory.set(m),
    readPadiMemory: readPadiMemoryOnce,
  }),
  // The bound padi's own liveness: a disconnect projects into `onState` IMMEDIATELY
  // (before the next 5s tick), so a resample runs at once and the rail reports padi +
  // its kaval as `absent` right away — never a frozen RSS for an already-gone process.
  (resample) => padiSession.onState(() => resample()),
);

// Drive koluSurface's `padiLink` cell off the bound padi's connection state. koluSurface
// is served DIRECTLY by kolu-server — never through the re-serve value-fold that HOLDS
// STALE while padi is unbound — so its value is never a frozen-but-live-looking read.
// The client folds `padiLink` into the warming/degraded canvas so a padi drop (the
// re-targeted "restart kaval" drains padi) shows an honest connecting state over the
// WHOLE drain window instead of a frozen re-served daemonStatus (#1034). `onState` fires
// the current state synchronously on subscribe, so the cell is seeded before the first
// transition.
padiSession.onState((s) => {
  koluSurfaceCtx.cells.padiLink.set(mapConnectionToPadiLink(s.connection));
  // Publish the rail's uptime source off the SAME onState: kolu-server's own boot
  // time (constant) plus the bound padi's honest boot time (`null` while unbound). A
  // padi (re)connect refreshes padi's uptime and a drop clears it to the honest
  // "unknown" at once — never a stale age. The cell's `equals` dedups a transition
  // that moves neither boot time. kaval's uptime is NOT here (it rides `daemonStatus`).
  koluSurfaceCtx.cells.processStartedAt.set({
    server: serverStartedAt,
    padi: padiSession.padiStartedAt(),
  });
});

// Feed the Kaval + Padi dialogs' host-daemon inventory: enumerate EVERY running kaval
// + padi on this host (read-only — scan the runtime dir, read each gate `.pid`, and a
// best-effort `system.version`/`terminal.list` probe per kaval; NEVER touches a
// daemon's lifecycle), mark which one kolu's bound padi owns, and publish
// `daemonInventory`. So a LEAKED post-upgrade daemon — invisible in the UI before,
// surfaced only by a `kaval-tui` CLI error — is diagnosable at a glance. The active
// kaval/padi sockets are DETERMINISTIC from padi's state-root digest (`ensurePadiBinding`
// resolves the SAME default), so they mark "in use by kolu" by socket identity; the
// active padi's honest `surfaceVersion` (off its control-core `hello`) rides the bound
// session. A padi (re)bind force-samples so its version + marking refresh at once.
const inventoryStateRoot = resolvePadiStateRoot();
startDaemonInventorySampler(
  {
    discoverKavals: discoverKavalDaemons,
    discoverPadis: discoverPadiDaemons,
    probe: probeKavalStatus,
    activeKavalSocket: padiKavalSocketPath(inventoryStateRoot),
    activePadiSocket: padiSocketPath(inventoryStateRoot),
    activePadiSurfaceVersion: () => padiSession.padiSurfaceVersion(),
    publish: (inv) => koluSurfaceCtx.cells.daemonInventory.set(inv),
  },
  (resample) => padiSession.onState(() => resample()),
);

// --- TLS setup ---
const tlsOptions = await resolveTlsOptions(argv.flags);

const { host, port } = argv.flags;

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
    // Interim heap instrumentation (no-op unless KOLU_DIAG_DIR is set) — logs the
    // heap curve with kolu-server's OWN subsystem counts. The padi-domain columns
    // (live-terminal count, active claude sessions) dropped at the cutover: they
    // read padi's in-process registry, which lives in the padi PROCESS now, and
    // padi keeps its OWN heap diag. This log tracks kolu-server's memory.
    startHeapDiagnostics({
      log,
      snapshotPrefix: "baseline",
      // "diag" preserves the server's long-standing log events
      // (diag_enabled / diag / diag_baseline_snapshot_*) that grep/alerting
      // depend on — kept decoupled from the snapshot file basename above.
      logPrefix: "diag",
      extraColumns: () => ({
        publisherSize: publisherSize(),
        pendingSummaryFetches: getPendingSummaryFetches(),
      }),
    });
  },
);

// --- oRPC WebSocket handler (streaming) ---
const wss = new WebSocketServer({ noServer: true });
// The acceptance seam (`@kolu/surface-app/server`) owns the liveness reaper AND
// sequences the per-socket stale-tab gate → reaper enrolment → dispatch in one
// `accept(...)` call. Reaping the server-side zombie (and its stream
// subscriptions) a half-open client would leak is the server half; the client
// half (the watchdog folded into `createServerLifecycle`) un-freezes the tab.
// The stale-tab gate closes a tab bound to a PREVIOUS instance BEFORE oRPC
// upgrades the socket (so dead-terminal subscriptions never replay and storm the
// logs with NOT_FOUND) and such a socket never enrols — so #1231's gate is
// untouched. `serverProcessId` is the same id the `identity.info` probe reports.
const acceptor = acceptSurfaceSocket({
  server: wss,
  liveProcessId: serverProcessId,
  onError: (err) => log.error({ err }, "ws error"),
  onReject: (claimedPid) =>
    log.info(
      { claimedPid, serverProcessId },
      "rejecting stale client — server restarted since it last connected",
    ),
});

let nextConnId = 0;
wss.on("connection", (ws: WebSocket, _req: IncomingMessage, url: URL) => {
  const connId = ++nextConnId;
  const connLog = log.child({ ws: connId });
  // `accept` gates (stale-tab) → enrols in the reaper → runs our dispatch. A
  // stale tab is closed and never dispatched or enrolled.
  acceptor.accept(ws, url, () => {
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
  });
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host}`);
  if (url.pathname === "/rpc/ws") {
    // CSWSH gate: reject a cross-site browser Origin before oRPC ever sees the
    // socket. The RPC surface is unauthenticated and cookie-less, so without
    // this any page the operator visits could open `/rpc/ws` and drive every
    // procedure. Loopback binding does NOT help — the attacker page runs in the
    // operator's own browser. Non-browser clients send no Origin and pass;
    // same-origin UI traffic passes; see `@kolu/surface/ws-origin`.
    if (
      gateWsOrigin(req, socket, {
        allowedOrigins,
        onReject: (origin) =>
          log.warn({ origin }, "rejecting ws upgrade: disallowed Origin"),
      })
    ) {
      return;
    }
    // Pass the pre-parsed `url` as a 3rd arg so the connection handler reads
    // `pid` without re-parsing `req.url`.
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, url);
    });
  } else {
    socket.destroy();
  }
});
