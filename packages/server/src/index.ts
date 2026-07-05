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
  previewFile,
  probeKavalStatus,
  publisherSize,
} from "@kolu/padi/assembly";
import { discoverKavalDaemons, legacyKavalSocketPath } from "kaval";
import {
  PADI_FORWARDING_POLICY,
  type PadiProcessMemory,
  padiSurface,
} from "@kolu/padi/surface";
import { surfaceClientRef } from "@kolu/surface/project";
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
import type { ServeResult } from "@kolu/serve-dir";
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
  assembleRemotePreview,
  previewTailFromRawUrl,
  rawTargetFromContext,
} from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { installRouteErrorLogging } from "./routeErrors.ts";
import { startDaemonInventorySampler } from "./daemonInventory.ts";
import { liveSamplerDeps, startMemorySampler } from "./memorySampler.ts";
import { ensurePadiBinding } from "./padiBinding.ts";
import type { PadiSession } from "./padiSession.ts";
import {
  ensureRemotePadiBinding,
  remotePadiHost,
} from "./remotePadiBinding.ts";
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

// Catch-all error logger: an uncaught route/middleware fault (e.g. the artifact-sdk
// HTML decorator draining a remote-preview stream that faults mid-chunk, past the
// preview route's own 503 `try`) is LOGGED, not answered as Hono's default,
// unlogged 500. See `routeErrors.ts`.
installRouteErrorLogging(app, log);

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
// The host-selection knob (W3.1): `KOLU_PADI_HOST=<ssh host>` binds a REMOTE padi
// over ssh — the whole canvas becomes that host — while UNSET keeps today's LOCAL
// binding byte-identical. OFF by default, no UI (the picker + per-view bindings are
// W3.2). Both arms return a `BoundPadi`, so `reServeSurface` and the router below
// are identical; only the session's front (local Endpoint vs ssh HostSession)
// differs. The remote arm does NOT await first-connect — provisioning a closure
// over ssh can take seconds, and the binding is fail-open (the connection cell
// reports copying/connecting/degraded while it warms).
const remoteHost = remotePadiHost();
const padiSession: PadiSession = remoteHost
  ? ensureRemotePadiBinding({
      host: remoteHost,
      // Forward THIS kolu build's app version so the remote-spawned PTYs' own
      // `TERM_PROGRAM_VERSION` is the kolu app version (byte-identical to the local
      // arm's `--spawn-version`), not the remote padi's own commit. Rides through
      // `padi --stdio`'s re-exec to the durable daemon.
      spawnVersion: serverVersion,
    })
  : ensurePadiBinding({
      // The nix-shell env whitelist rides padi's CLI flag (kolu-server no longer
      // spawns PTYs — padi's kaval does — so `configureNixShellEnv` is FORWARDED to
      // padi, not called here).
      nixShellWhitelist: argv.flags.allowNixShellWithEnvWhitelist,
      // The W2.2 upgrade bridge: hand padi THIS binder's OWN listen-port legacy
      // kaval socket, so a first W2.2 boot ADOPTS a running pre-W2.2 kaval
      // (`kaval-<port>/`) instead of spawning a fresh digest kaval and leaking it.
      // The binder is the ONLY hinter — and only of its OWN port — so a dev instance
      // at another port is never adopted; padi ignores the hint once its digest
      // kaval is live, so it converges.
      legacyKavalSocket: legacyKavalSocketPath(argv.flags.port),
      // Forward the kolu app version so spawned PTYs' `TERM_PROGRAM_VERSION` stays
      // the kolu app version (byte-identical to the pre-cutover in-process spawn),
      // not padi's own commit hash. padi stamps this via its `--spawn-version` flag.
      spawnVersion: serverVersion,
      // Forward `--verbose` to padi's process (as `LOG_LEVEL=debug`) so its OWN pino
      // domain logger emits debug — the split-process twin of the pre-cutover
      // `padiLog.level = "debug"`.
      verbose: argv.flags.verbose,
    });

// `padiSession` is a `PadiSession` (a `DaemonSession<PadiSurfaceClient>`, from the
// local or remote arm's `makeSession` + spread); it plugs into `reServeSurface`'s loose
// `Session` receptacle checked (S3 dropped the dead contract `<C>` at the role
// boundary, so only the SURFACE spec is named here).
const reServedPadi = reServeSurface<typeof padiSurface.spec>({
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

// An IN-PROCESS client of the re-serve mirror — a `directLink` over the mirror's
// own router, no socket/ssh hop. The memory sampler reads padi's `{ padi, kaval }`
// pair off THIS (the value the re-serve already folds into its per-binding store)
// instead of opening a second transport to padi. `surfaceClientRef` pins the client
// type off the mirror's surface; the router is opaque (`unknown`), so it's cast to
// the factory's router param exactly as the mirror's own re-serve does.
const reServedPadiClient = surfaceClientRef(
  reServedPadi.surface,
  reServedPadi.router as Parameters<typeof surfaceClientRef>[1],
);

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
  drainBoundPadi: () => padiSession.renew(),
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
  // terminal registry now. padi resolves terminal id → repoRoot; how kolu-server
  // then reads the bytes forks on the binding (local disk vs. the bound host), see
  // below. Either way the file is never forced whole through the base64 procedure.
  const clientPromise = padiSession.currentClient();
  // A degraded/warming binding (skew · unconverged · linkFailed · not-yet-connected)
  // yields a NULL `currentClient()` (`remotePadiBinding.ts` currentClient) — a loud
  // 503 here, never a hang. Both the client AWAIT and the repoRoot resolve stay INSIDE
  // the try so a client-promise rejection (a fresh spawn that fails its handshake) maps
  // to the same 503 link-fault, not an uncaught 500.
  if (!clientPromise) return c.text("padi is not connected", 503);
  let client: Awaited<typeof clientPromise>;
  let repoRoot: string | null;
  try {
    client = await clientPromise;
    ({ repoRoot } = await client.surface.preview.repoRootForTerminal({
      terminalId,
    }));
  } catch (err) {
    // padi's `repoRootForTerminal` returns `{ repoRoot: null }` for an
    // unknown/unmapped terminal — it never THROWS for the no-repo case (that is
    // the `if (!repoRoot)` 404 below). So a thrown error here is an OPERATIONAL
    // failure of the bound link (the client promise rejected, padi went down
    // mid-read, a protocol error, an unexpected handler fault), NOT "no repo".
    // Surface it as a 503 so the real fault is visible instead of masqueraded as an
    // ordinary missing-file 404.
    log.error({ err, terminalId }, "padi repoRoot resolve failed (link fault)");
    return c.text("padi link fault resolving terminal repo", 503);
  }
  if (!repoRoot) return c.text("terminal has no repo", 404);
  // Bind to a const so the non-null narrowing survives into the remote closure.
  const repoPath = repoRoot;

  const range = c.req.header("range");
  // `If-Range` guards a `<video>` seek against the file changing mid-session: both
  // arms honor the `Range` only while this validator still matches the file's
  // current ETag (RFC 9110 §13.1.3), else serve the full 200.
  const ifRange = c.req.header("if-range");
  // The byte read forks on the binding — but the file tail + repoRoot (and their
  // `..`/`%2f` defenses above) are identical for both arms, so a remote path never
  // reaches a local read, and vice versa.
  //   - REMOTE (KOLU_PADI_HOST): the file lives on the ssh HOST, so dial the bound
  //     padi's `preview.read` in bounded chunks (`assembleRemotePreview`) — the RIGHT
  //     host's bytes, streamed back with an O(chunk) heap on both hops. padi
  //     re-enforces its realpath/403 guard host-side inside the read.
  //   - LOCAL: read THIS machine's disk directly via the shared streaming
  //     `previewFile` (the same underlying serve-dir read padi serves) — no hop, no
  //     base64 round trip, byte-identical to before.
  // Both return serve-dir's `ServeResult` shape; the artifact-sdk HTML decorator
  // (mounted above) rewrites text/html downstream in either case.
  let r: ServeResult;
  if (remoteHost) {
    // The remote arm's METADATA dials (the 1-byte probe + any re-dial) run
    // synchronously inside this await; a link fault there maps to the SAME logged
    // 503 as the repoRoot resolve above. The streaming body's per-chunk dials run
    // LATER, when the Response is consumed, so a fault there can't reach THIS catch —
    // but it is NOT swallowed: for a binary preview the stream goes straight to the
    // socket and the fault resets the connection (loud at the transport); for a
    // `text/html` preview the artifact-sdk decorator buffers the body via
    // `res.text()`, so the fault throws in that middleware and is caught by the
    // app-wide `installRouteErrorLogging` handler (a LOGGED 500). Either way loud,
    // never a silent short body.
    try {
      r = await assembleRemotePreview(
        (chunkRange) =>
          client.surface.preview.read({
            repoPath,
            filePath: rawTail,
            range: chunkRange,
          }),
        range,
        ifRange,
      );
    } catch (err) {
      log.error({ err, terminalId }, "padi preview read failed (link fault)");
      return c.text("padi link fault serving preview", 503);
    }
  } else {
    r = await previewFile({ repoPath, filePath: rawTail, range, ifRange });
  }
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

// Read padi's `{ padi, kaval }` memory pair off the RE-SERVE MIRROR — a one-shot
// read of the mirror's own `processMemory` cell (a snapshot-first subscription; take
// the first frame — the value the re-serve already folded into its per-binding store
// — and stop). This is the SAME reading the browser sees on `/surface/padi/*`, so
// the rail consumes the source of truth once folded rather than re-dialing padi on a
// second transport. Returns `null` when padi is DOWN (no live client), so a down padi
// folds to the honest `absent` — the liveness GATE decides down-ness, NOT the mirror
// store, which deliberately HOLDS its last value across an upstream drop (reading the
// store alone would report a dead process's stale-but-live figure). The one window the
// gate does not cover is a fresh REBIND: `currentClient()` flips live the instant padi
// reconnects, a beat before the mirror re-folds, so a resample in that beat can briefly
// surface the last-known reading until the next fold/tick overwrites it — bounded to one
// fold cycle and self-correcting on the coarse rail (a named, accepted residual; Ledger
// L14). A read that FAILS through a live mirror returns the `error` reading instead
// (never `null`), so a real anomaly stays distinct from `absent`. kaval runs inside the
// padi process now, so padi (not kolu-server) is the source of that pair; the sampler
// folds it in below.
async function readPadiMemoryOnce(): Promise<PadiProcessMemory | null> {
  // The bound padi's liveness is the gate — no live client → honest `absent` (the gate,
  // not the held store, decides down-ness). M2 (a standing skew nulls the client) and
  // the onState flip-to-absent both ride this exactly as the old bound-session read did;
  // a fresh rebind has a bounded stale-read window until the mirror re-folds (see above).
  if (!padiSession.currentClient()) return null;
  const ctl = new AbortController();
  try {
    // `reServedPadiClient` is an in-process `directLink` over the mirror's router, so
    // this reads the folded store with no socket/ssh hop and the same cell verb.
    const iterable = await reServedPadiClient.surface.processMemory.get(
      {},
      { signal: ctl.signal },
    );
    for await (const frame of iterable) return frame;
    // The client was live but the cell yielded no frame — an operational anomaly,
    // not "no process to measure". Report `error`, not `absent`, and log at `error`
    // (a live-client read that produced nothing is a failed read, not a degraded-but-
    // recoverable state — see `.agency/code-police.md` errors-must-log-at-error).
    log.error({}, "padi memory read yielded no frame through the mirror");
    return PADI_MEMORY_READ_ERROR;
  } catch (err) {
    // padi was BELIEVED up (a live client) yet the mirror read threw — surface the
    // honest `error` state, distinct from `absent`, rather than collapsing a caught
    // error to the empty "no process" reading. padi's liveness still rides the
    // re-serve's own `connection` cell; this only affects the memory rail's three-way
    // readout. A caught read failure is a real error, not `warn`
    // (errors-must-log-at-error).
    log.error({ err }, "padi memory read failed through the mirror");
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
// Map the base `session.identity()` sum onto the three daemon-inventory readouts the
// dialog reads (uptime · contract version · navigable commit). `identity()` is TOTAL
// (disconnected | anonymous | identified); padi always DECLARES its build, so a bound
// padi is always `identified`, a mid-reconnect gap is `disconnected` (never
// `anonymous`). This REPLACES the six bespoke `padiStartedAt`/`padiSurfaceVersion`/…
// readouts with one universal member (S4).
const padiStartedAt = (): number | null => {
  const id = padiSession.identity();
  return id.kind === "disconnected" ? null : id.startedAt;
};
const padiSurfaceVersion = (): string | null => {
  const id = padiSession.identity();
  return id.kind === "identified" ? id.baked.contractVersion : null;
};
const padiBuildCommit = (): string | null => {
  const id = padiSession.identity();
  // A navigable commit → its sha; a dev build (or unidentified) → null (honest "—").
  return id.kind === "identified" && id.baked.commit.kind === "commit"
    ? id.baked.commit.sha
    : null;
};

padiSession.onState((s) => {
  koluSurfaceCtx.cells.padiLink.set(mapConnectionToPadiLink(s.connection));
  // Publish the rail's uptime source off the SAME onState: kolu-server's own boot
  // time (constant) plus the bound padi's honest boot time (`null` while unbound). A
  // padi (re)connect refreshes padi's uptime and a drop clears it to the honest
  // "unknown" at once — never a stale age. The cell's `equals` dedups a transition
  // that moves neither boot time. kaval's uptime is NOT here (it rides `daemonStatus`).
  koluSurfaceCtx.cells.processStartedAt.set({
    server: serverStartedAt,
    padi: padiStartedAt(),
  });
});

// Feed the Kaval + Padi dialogs' host-daemon inventory. The BOUND host's daemons now
// ride padiSurface's `hostInventory` member (padi scans its OWN host — the one scanner,
// homed in @kolu/padi — and marks the kaval it holds + itself active); that member rides
// the re-served surface straight to the client, so the dialog's bound-host list works
// identically local and remote. Here kolu-server publishes only what IT knows on
// koluSurface's `daemonInventory`: the binding host, its OWN machine's scan (only under a
// remote binding, where that machine is not the bound host — so a leak on the machine
// you're actually using stays visible; the SAME `enumerateHostDaemons` the member uses,
// marking none active), and the bound padi's honest identity + a standing convergence
// anomaly off its control-core `hello`. A padi (re)bind force-samples so version +
// convergence refresh at once.
startDaemonInventorySampler(
  {
    discoverKavals: discoverKavalDaemons,
    discoverPadis: discoverPadiDaemons,
    probe: probeKavalStatus,
    activePadiSurfaceVersion: () => padiSurfaceVersion(),
    activePadiBuildCommit: () => padiBuildCommit(),
    activePadiConvergence: () => padiSession.convergence(),
    // The SINGLE bind knob: the remote host (`KOLU_PADI_HOST`), or null for a local bind
    // (`|| null` folds an empty KOLU_PADI_HOST to null, matching the `remoteHost ?` bind
    // decision above). daemonInventory derives `boundLocally = boundHost === null` — under
    // a local binding the bound padi's `hostInventory` member already covers this machine,
    // so no `localScan` is published (no duplicate list); under a remote binding kolu-server
    // scans its own machine into `localScan`, labelled "this machine, not the bound host".
    boundHost: remoteHost || null,
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
