import type { IncomingMessage } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { serve } from "@hono/node-server";
import { mountArtifactSdk } from "@kolu/artifact-sdk/server";
import { startHeapDiagnostics } from "@kolu/heap-diag";
// The web shell reaches the terminal domain ONLY through @kolu/padi's published
// entry points (the package-boundary seal). Post-cutover it runs no terminal
// domain; it keeps a `publisherSize` diagnostic and the daemon-scan helpers the
// inventory sampler reads. The re-serve + preview-read now ride the host pool.
import {
  discoverPadiDaemons,
  probeKavalStatus,
  publisherSize,
} from "@kolu/padi/assembly";
import type { PadiProcessMemory } from "@kolu/padi/surface";
import type { ServeResult } from "@kolu/serve-dir";
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
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { RPCHandler } from "@orpc/server/fetch";
import { cli } from "cleye";
import { Hono } from "hono";
import { pinoLogger } from "hono-pino";
import { discoverKavalDaemons, legacyKavalSocketPath } from "kaval";
import { getPendingSummaryFetches } from "kolu-claude-code";
import { DEFAULT_PORT } from "kolu-common/config";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import { type WebSocket, WebSocketServer } from "ws";
import { serverHostname, serverProcessId, serverVersion } from "./hostname.ts";
import { buildHostPool, LOCAL_HOST } from "./hostPool.ts";
import {
  assembleRemotePreview,
  previewTailFromRawUrl,
  rawTargetFromContext,
} from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { liveSamplerDeps, startMemorySampler } from "./memorySampler.ts";
import { wirePerHostKoluCells } from "./perHostKoluCells.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { remotePadiHost } from "./remotePadiBinding.ts";
import { installRouteErrorLogging } from "./routeErrors.ts";
import { store } from "./state.ts";
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
// W3.2). Both arms return a `PadiSession` (a `DaemonSession` — `makeSession` + the
// daemon members by spread), so `reServeSurface` and the router below are identical;
// only the transport connector (local `endpointConnector` vs ssh `sshConnector`)
// differs. The remote arm does NOT boot-await first-connect — provisioning a closure
// over ssh can take seconds, and the binding is fail-open (the connection cell reports
// copying/connecting/degraded while it warms); the LOCAL arm IS boot-awaited below.
// W4 "the switch": the WARM POOL. kolu-server no longer marries ONE padi at boot —
// it holds a `buildHostRegistry` with one `PadiSession` per machine (local endpoint
// arm for the local host, ssh arm otherwise), dispatched per browser connection by
// the `?host=` query param at ws-upgrade. `KOLU_PADI_HOST` sets the DEFAULT host —
// the one a tab binds when it names none, so a CI run boots through it — but the
// (Debug-only) picker switches freely away from it. `recentHosts` (server-persisted
// preferences) seeds the pool so a device lands on its known hosts.
const bootHost = remotePadiHost();
// Cap the remembered-host list so it can't grow without bound over an install's
// lifetime: every recent host is re-warmed into a live PadiSession + re-serve pump
// at each boot (see the pool's `initialHosts`), so an uncapped list would dial an
// ever-growing fan of ssh sessions on every restart. Keep the most-recent N; older
// picks age out of the picker (and stop being auto-warmed), mirroring padi's own
// `MAX_RECENT_REPOS`/`MAX_RECENT_AGENTS` MRU caps.
const MAX_RECENT_HOSTS = 20;
const pool = buildHostPool({
  bootHost,
  recentHosts: store.get("recentHosts").slice(-MAX_RECENT_HOSTS),
  // The pool's host set (local excluded) IS the user's recentHosts; write it back
  // through the SERVER-authority `recentHosts` cell (capped, D1). Its Conf-backed store
  // makes one `.set` BOTH persist to disk AND publish to every connected device — so an
  // add on one device updates another's open picker live (the local-authority preferences
  // cell couldn't: the client seeds from the first yield and ignores later pushes).
  persistRecentHosts: (hosts) =>
    koluSurfaceCtx.cells.recentHosts.set(hosts.slice(-MAX_RECENT_HOSTS)),
  localArmOpts: {
    // The nix-shell env whitelist rides padi's CLI flag (kolu-server no longer spawns
    // PTYs — padi's kaval does — so it is FORWARDED to padi, not called here).
    nixShellWhitelist: argv.flags.allowNixShellWithEnvWhitelist,
    // The W2.2 upgrade bridge: hand padi THIS binder's OWN listen-port legacy kaval
    // socket so a first W2.2 boot ADOPTS a running pre-W2.2 kaval instead of leaking it.
    legacyKavalSocket: legacyKavalSocketPath(argv.flags.port),
    // Forward the kolu app version so spawned PTYs' `TERM_PROGRAM_VERSION` stays the
    // kolu app version (byte-identical to the pre-cutover in-process spawn).
    spawnVersion: serverVersion,
    // Forward `--verbose` to padi's process (as `LOG_LEVEL=debug`).
    verbose: argv.flags.verbose,
  },
  remoteSpawnVersion: serverVersion,
  koluSurfaceRouter,
  // A1 — each pool entry gets its OWN per-host `kolu` diagnostic cells (padi uptime +
  // daemon inventory), wired to that entry's session. index.ts owns the server-own
  // facts (`serverStartedAt`) + the machine-scan seams; hostPool splices the result.
  buildHostKoluCells: (host, session) =>
    wirePerHostKoluCells({
      host,
      session,
      discoverKavals: discoverKavalDaemons,
      discoverPadis: discoverPadiDaemons,
      probe: probeKavalStatus,
    }),
  rpcPlugins,
});

// The samplers + the shell's uptime/inventory rail read the DEFAULT host's binding
// (the shared kolu surface is host-independent; per-host readiness rides the re-served
// padi `connection` cell, folded into `padi.health().live` on the client). The default
// binding is built at pool construction, so this is present — a fail-fast guard if not.
const defaultSession = pool.registry.getSession(pool.defaultHost);
const defaultMirror = pool.getMirror();
if (!defaultSession || !defaultMirror) {
  throw new Error(
    `default host binding "${pool.defaultHost}" missing from the pool`,
  );
}

// BOOT-AWAIT the LOCAL padi arm before serving browsers: `makeSession` warms on the
// first `pin()`, so without this the first re-served request (an e2e's `killAll`)
// races an un-connected arm. The LOCAL binding is always in the pool; warm it here so
// a switch to local is instant (and, when local IS the default, so the first request
// doesn't race). Fail-OPEN: a boot failure surfaces on the connection cell and the loop
// retries, so don't crash boot. The remote arm is fail-open by construction (not awaited).
const localSession = pool.registry.getSession(LOCAL_HOST);
await localSession?.pin().catch((err: unknown) => {
  log.error({ err }, "padi endpoint failed to come up at boot");
});

// --- oRPC HTTP handler (non-streaming calls) ---
// A SINGLE handler bound to the DEFAULT host's router — the HTTP `/rpc/*` path carries
// no `?host`, and its only real user is the e2e reset (POSTs to /rpc/surface/padi/*),
// which targets the default host. WS (streaming, the client's real transport) is
// per-host, dispatched from the pool at upgrade (below).
// biome-ignore lint/suspicious/noExplicitAny: dynamic surface-router splice; runtime shape is a valid router.
const rpcHandler = new RPCHandler(pool.getRouter() as any, {
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

  // Which host's padi owns this terminal — the tab that opened this preview appends
  // its bound host as `?host` (W4). An unknown host is a loud 404, never a silent
  // wrong-host read. H4 — the client ALWAYS appends `?host` now (`buildTerminalFileUrl`),
  // so a request WITHOUT it is a RELATIVE SUBRESOURCE inside a preview iframe (an HTML/
  // markdown preview's `<img src="./x">`) whose request drops the parent's query. It
  // falls to the default host — which is the WRONG host's fs for a tab viewing a remote
  // host. Make that visible rather than silent; the full per-subresource host-threading
  // (a `<base>` carrying `?host`, or path-based host routing) rides A1's shape.
  const hostParam = c.req.query("host");
  if (hostParam === undefined) {
    log.warn(
      { terminalId },
      "preview subresource without ?host — falling to the default host (may read the wrong host's fs); per-subresource host routing is a known follow-up",
    );
  }
  const host = hostParam ?? pool.defaultHost;
  const previewSession = pool.registry.getSession(host);
  if (!previewSession) return c.text(`unknown host: ${host}`, 404);
  // Which directory this terminal serves (its git repo root) — RE-SOURCED from padi's
  // registry over THAT host's bound session, since padi (not kolu-server) owns the
  // terminal registry. padi resolves terminal id → repoRoot; the bytes are then read
  // back through the same bound session, never forced whole through the base64 procedure.
  const clientPromise = previewSession.currentClient();
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
  // `If-Range` guards a `<video>` seek against the file changing mid-session: honor
  // the `Range` only while this validator still matches the file's current ETag
  // (RFC 9110 §13.1.3), else serve the full 200.
  const ifRange = c.req.header("if-range");
  // The file lives on the bound host (local endpoint or ssh) — ALWAYS read through
  // the bound padi's `preview.read` in bounded chunks (`assembleRemotePreview`), so a
  // remote tab gets the RIGHT host's bytes and a local tab reads its own disk through
  // its own padi. The old `if (remoteHost)` local-disk shortcut (`previewFile`) is
  // GONE (W4, closing the #1685 deferral): with a warm pool "is this local?" is a
  // per-tab fact, and the local endpoint arm serves `preview.read` too, so ONE path is
  // correct for every binding. padi re-enforces its realpath/403 guard host-side.
  //
  // The METADATA dials (the 1-byte probe + any re-dial) run synchronously inside this
  // await; a link fault there maps to the SAME logged 503 as the repoRoot resolve above.
  // The streaming body's per-chunk dials run LATER (when the Response is consumed), so a
  // fault there can't reach THIS catch — but it is NOT swallowed: a binary preview goes
  // straight to the socket and the fault resets the connection (loud at the transport);
  // a `text/html` preview is buffered by the artifact-sdk decorator (`res.text()`), so
  // the fault throws in that middleware and the app-wide error logger catches it (a
  // LOGGED 500). Either way loud, never a silent short body.
  let r: ServeResult;
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
    log.error(
      { err, terminalId, host },
      "padi preview read failed (link fault)",
    );
    return c.text("padi link fault serving preview", 503);
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
// A const arrow (not a hoisted declaration) so the `defaultSession`/`defaultMirror`
// non-null guard above narrows INTO this closure (a hoisted function body is checked
// with the outer `| undefined` types).
const readPadiMemoryOnce = async (): Promise<PadiProcessMemory | null> => {
  // The bound padi's liveness is the gate — no live client → honest `absent` (the gate,
  // not the held store, decides down-ness). M2 (a standing skew nulls the client) and
  // the onState flip-to-absent both ride this exactly as the old bound-session read did;
  // a fresh rebind has a bounded stale-read window until the mirror re-folds (see above).
  if (!defaultSession.currentClient()) return null;
  const ctl = new AbortController();
  try {
    // `defaultMirror` is an in-process `directLink` over the mirror's router, so
    // this reads the folded store with no socket/ssh hop and the same cell verb.
    const iterable = await defaultMirror.surface.processMemory.get(
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
};

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
  (resample) => defaultSession.onState(() => resample()),
);

// A1 — the padi uptime + daemon-inventory readouts are now built PER HOST in the pool
// (`perHostKoluCells.ts`, wired per entry to that host's `session.identity()` /
// `convergence()`), so a tab reads the ACTIVE host's facts, not the boot default's.
// The default-host `processStartedAt` driver + `startDaemonInventorySampler` block that
// lived here (pinned to `defaultSession`) moved there. `defaultSession` / `koluSurfaceCtx`
// remain the memory sampler's + `readPadiMemoryOnce`'s + `persistRecentHosts`' owners.

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
    // W4 "the switch": dispatch to the connection's declared host. The tab names
    // it in `?host=<host>` (the default host when omitted, so a tab that never
    // switches is byte-identical). An UNKNOWN host is rejected with close 1008 —
    // the picker `add`s a host BEFORE opening its socket, so a fresh socket for a
    // host not in the pool never provisions ssh from a stray query param. This is
    // an unexpected but RECOVERABLE case, not a hard failure — e.g. a stale tab
    // still bound to a host another device just removed; the client treats the
    // 1008 as "host gone" and falls back to local, so `warn` (not `error`) is the
    // right level. Each host has its OWN handler (its re-served padi + the shared
    // kolu/surfaceApp fragment), so a call minted on one host's socket can never
    // reach another — the pool is the misroute boundary on the server side.
    const host = url.searchParams.get("host") ?? pool.defaultHost;
    const handler = pool.registry.getHandler(host);
    if (!handler) {
      connLog.warn({ host }, "rejecting ws: host not in pool");
      ws.close(1008, `unknown host: ${host}`);
      return;
    }
    connLog.info({ total: wss.clients.size, host }, "connected");
    // Track the socket against its host so `hosts.remove` can close it (and the
    // reaper accounting stays per-host).
    pool.registry.registerConnection(host, ws);
    handler.upgrade(ws, { context: {} });
    ws.on("close", (code, reason) => {
      pool.registry.unregisterConnection(host, ws);
      const reasonStr = reason.toString();
      connLog.info(
        {
          code,
          host,
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
