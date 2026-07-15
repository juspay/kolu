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
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
import {
  PADI_FORWARDING_POLICY,
  type PadiProcessMemory,
  padiSurface,
} from "@kolu/padi/surface";
import type { ServeResult } from "@kolu/serve-dir";
import { directLink } from "@kolu/surface/links/direct";
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
import {
  buildRemotePool,
  type ReServedSurface,
  reServeSurface,
  serveHostMap,
} from "@kolu/surface-remote";
import { LoggingHandlerPlugin } from "@orpc/experimental-pino";
import { RPCHandler } from "@orpc/server/fetch";
import { RPCHandler as WsRPCHandler } from "@orpc/server/ws";
import { cli } from "cleye";
import { Hono } from "hono";
import { pinoLogger } from "hono-pino";
import { discoverKavalDaemons, legacyKavalSocketPath } from "kaval";
import { getPendingSummaryFetches } from "kolu-claude-code";
import { DEFAULT_PORT } from "kolu-common/config";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import {
  TERMINAL_FILE_ROUTE_BASE,
  TERMINAL_FILE_ROUTE_FILE_SEGMENT,
} from "kolu-common/preview";
import {
  type HostKey,
  HostKeySchema,
  LOCAL_HOST,
  PADI_SURFACE_NAME,
  type PadiEntryFailure,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import { type WebSocket, WebSocketServer } from "ws";
import { startDaemonInventorySampler } from "./padi/daemonInventory.ts";
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
import { liveSamplerDeps, startMemorySampler } from "./memorySampler.ts";
import {
  ensurePadiBinding,
  handlePadiBootFailure,
} from "./padi/padiBinding.ts";
import { mapConnectionToPadiLink } from "./padi/padiLink.ts";
import { padiFailureOf, type PadiSession } from "./padi/padiSession.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import {
  assertRemovableHost,
  ensureRemotePadiBinding,
  parseKoluPadiHostSeed,
} from "./padi/remotePadiBinding.ts";
import { pruneToMembers } from "./padi/reServeEviction.ts";
import { getPersistedHosts, savePoolMembership } from "./hostPersistence.ts";
import { installRouteErrorLogging } from "./routeErrors.ts";
import { buildAppRouter } from "./router.ts";
import {
  claimLocalSupervisor,
  supervisorConflictError,
} from "./padi/supervisorClaim.ts";
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

// The local-supervisor gate's release (set once the gate is claimed at boot,
// below). Released on a clean shutdown so a same-lineage restart re-claims
// immediately rather than reaping a stale (still-correct-but-tidier) gate. `null`
// until the claim lands; a crash skips it and the next boot's liveness reap
// handles the stale pid.
let releaseLocalSupervisor: (() => void) | null = null;

// --- Graceful shutdown ---
// Signals map to a clean exit; the fatal handlers make a floating promise or a
// sync throw as terminal as each other (the supervisor restarts clean). There is
// NO on-exit scratch cleanup here anymore: the per-process scratch dir moved into
// the padi process (padi owns `ensureKoluRoot`/`shutdownCleanup` under its
// state-root), so kolu-server has nothing to wipe.
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.on(sig, () => {
    log.info({ signal: sig }, "shutting down");
    releaseLocalSupervisor?.();
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
// NEVER awaited before the HTTP server listens — for EITHER arm. A slow/failed padi
// (a stale gate, a wedged spawn, a genuinely down host) must not hold `serve()` back;
// a boot failure reports the down state through the re-serve's `connection` cell
// rather than crashing OR blocking (fail-open). See the LOCAL-arm pin below for the
// W4 fix that extended this from remote-only to both arms.
// ─────────────────────────────────────────────────────────────────────────────
// The KOLU_PADI_HOST seed — the pool's host set. LOCAL_HOST is the implicit,
// UNREMOVABLE default (always `seed[0]`); the env may append remote hosts. ALWAYS-MAP:
// env-unset = a 1-member pool = pixel-identical to today's single local padi.
const seed = parseKoluPadiHostSeed();
// LOCAL_HOST — the unremovable default the canvas boots on (always `seed[0]`; the `??`
// only satisfies the indexed-access optional — the parser always prepends it).
const defaultHost = seed[0] ?? LOCAL_HOST;

// W10 — restore the remembered fleet. Guest hosts added via the selector strip in a
// prior run are persisted in the conf state store (server-side, beside its one writer —
// the pool); merge them into the initial host set so they re-enter through the SAME seed
// → `buildEntry` → W6 connect pipeline the env seed uses (a gone host surfaces as a
// `failed` entry, never silently dropped). Deduped against the env seed so a host listed
// in BOTH `KOLU_PADI_HOST` and the store counts once. Seeding at construction (rather
// than a post-build `pool.add` loop) keeps the boot replay from re-firing `persist` — the
// store is only ever rewritten by a genuine runtime add/remove, so an interrupted boot
// can't truncate it. A store that PARSES but fails the hosts schema CRASHES here naming
// the store (`getPersistedHosts` — fail-loud), never starting with an empty fleet; an
// UNPARSEABLE store already threw in conf's own read (fail-fast, `clearInvalidConfig` false).
const persistedAtBoot = getPersistedHosts();
const envSeedKeys = seed.map(encodeHostKey);
const initialHostKeys = [...new Set([...envSeedKeys, ...persistedAtBoot])];
// Env-seed provenance (the `persist` hook's exclusion set): a `KOLU_PADI_HOST` seed is
// a DECLARATIVE knob, not a strip-added membership fact — persisting it would complect
// the two and make an env host permanent on disk after any unrelated add/remove (and
// survive its own removal from the env). Exclude env seeds from the store UNLESS they
// were already persisted at boot — persisted-at-boot wins, so a host a user
// strip-added and then LATER also named in `KOLU_PADI_HOST` keeps its persisted claim.
const persistedAtBootSet = new Set(persistedAtBoot);
const declarativeSeedKeys = new Set(
  envSeedKeys.filter((k) => !persistedAtBootSet.has(k)),
);

// ── P0: the local-supervisor ownership gate ────────────────────────────────────
// kolu-server SUPERVISES the local padi (spawns / adopts / drains it). A SECOND
// kolu-server pointed at the SAME state root would co-supervise the one padi and
// the two would drain-and-respawn it in a livelock (the two-local-kolu war). Claim
// a `supervisor.pid` gate BEFORE building the pool (so a foreign owner fails fast
// before we touch padi at all); a LIVE foreign holder is structurally unresolvable
// (retrying can't make it go away), so — exactly like a `PadiAdoptionRefusedError`
// — exit loud with the remedy rather than fight. A same-lineage restart (dead
// predecessor pid) reaps the stale gate and claims `self`, so it still drains. The
// REMOTE arm's twin is `remotePadiBinding.ts`'s anti-livelock fight-detection →
// `cross-supervisor` cause (D3), with `KOLU_REMOTE_PADI_STATE_DIR` the isolation lever.
const localSupervisorStateRoot = resolvePadiStateRoot();
const supervisorClaim = claimLocalSupervisor(localSupervisorStateRoot);
if (supervisorClaim.kind !== "self") {
  const err = supervisorConflictError(
    supervisorClaim,
    localSupervisorStateRoot,
  );
  log.fatal({ err }, err.message);
  process.exit(1);
}
releaseLocalSupervisor = supervisorClaim.release;

// The warm padi pool — one session per seed host. `buildRemotePool`'s host set is ALWAYS
// a plain string (the ssh pool's own key), so the seed's `HostKey` objects are ENCODED
// going in; `buildEntry` DECODES back to pick the local/remote arm and, for a remote,
// pass its bare ssh target (never the "remote:"-prefixed wire form) to `sshConnector`.
// `buildEntry` is SYNC (`makeSession` defers the dial into its own reconnect loop), so an
// unreachable seed host surfaces as a `failed` entry, never a boot throw. BOTH the
// default (local) arm and remote arms are fail-open (a local spawn+connect, or ssh
// provisioning, both take real time — the connection cell reports copying/connecting
// meanwhile, exactly the same shape for either). The `?host=` handler is unused (the
// map forwards by key-in-input, not a per-host socket), so `H = undefined`.
const pool = buildRemotePool<PadiSession, undefined>({
  initialHosts: initialHostKeys,
  // W10 — persist membership in the conf store beside its one writer (the pool). Fires on
  // every runtime add/remove with the intended post-mutation host list; the pool's own
  // contract orders this write BEFORE the in-memory commit, serializes it through one
  // mutation queue, and rolls back the just-built session if it throws. The callback only
  // shapes WHAT is written — the unremovable local default drops out (seeded in code, never
  // persisted, so the store can't mint a second authority for "local always exists").
  persist: (hosts) => savePoolMembership(hosts, declarativeSeedKeys),
  buildEntry: (h) => {
    const key = decodeHostKey(h);
    return {
      session:
        key.kind === "local"
          ? ensurePadiBinding({
              nixShellWhitelist: argv.flags.allowNixShellWithEnvWhitelist,
              legacyKavalSocket: legacyKavalSocketPath(argv.flags.port),
              spawnVersion: serverVersion,
              verbose: argv.flags.verbose,
              // A genuine adoption refusal is fatal on ANY dial, not just the boot
              // pin's first one below — a reconnect's own fire-and-forget loop would
              // otherwise swallow a LATER refusal silently (see the option's doc in
              // padiBinding.ts). Wired to the SAME handler the boot pin's catch uses,
              // so a first-dial and a later-dial refusal fail identically.
              onAdoptionRefused: (err) =>
                handlePadiBootFailure(err, { log, exit: process.exit }),
            })
          : ensureRemotePadiBinding({
              host: key.target,
              spawnVersion: serverVersion,
            }),
      handler: undefined,
    };
  },
});

// W4: pin the LOCAL padi arm WITHOUT awaiting it — extends the REMOTE arm's
// fail-open stance to local too, so a slow/wedged local padi (e.g. the #1713-class
// XDG_RUNTIME_DIR socket-path mismatch this fix half addresses, or any other spawn
// stall) can no longer hold the HTTP server's `serve()` back for its ~30s connect
// timeout. `makeSession` warms on the first `pin()`; this call (like the REMOTE
// arm's, and `reServeSurface`'s own pump below — `pin()` is idempotent, ref-counted)
// merely KICKS OFF that warm-up. A request racing the warm-up window sees the SAME
// thing a remote host's guest already shows meanwhile: the map/`padiLink` cell
// reports `connecting`/`disconnected` (never a lying `copying` — the local arm is a
// non-provisioning session, `serveHostMap`'s belt in juspay/kolu#1716), and a
// procedure call in that window fails loudly rather than silently (reServeSurface's
// documented "a call while the link is down throws"; the client already retries via
// its warming-chip UX, exactly as it does for a remote host). Fail-OPEN: a boot
// failure surfaces on the connection cell and the loop retries, so don't crash boot.
//
// ONE exception, handled by `handlePadiBootFailure`: a `PadiAdoptionRefusedError` is
// structurally UNRESOLVABLE (a resident padi owns this state root at a contract skew
// #1313 forbids touching) — retrying forever would just be a silent spinner behind
// the fail-open UI, which the boot acceptance bar forbids, so THAT one case exits
// loudly instead, naming the conflict + the remedy the error already composed.
pool
  .getSession(encodeHostKey(LOCAL_HOST))
  ?.pin()
  .catch((err: unknown) =>
    handlePadiBootFailure(err, { log, exit: process.exit }),
  );

// The default (local) session — kolu-server's OWN binding. The samplers (memory,
// daemon-inventory, uptime) and the `padiLink` `onState` below are kolu-server's own
// host-INDEPENDENT facts, so they bind to THIS unremovable default; the per-host padi
// facts (urgency, terminals, daemonStatus) ride the map's `entries`/members instead.
// `defaultHost` was just seeded into the pool above, so this lookup can't miss — but PROVE it
// (a named throw, not a bare `!`), so a future seed/pool refactor that broke the invariant fails
// fast with a clear error instead of a silent non-null narrowing. The IIFE keeps `padiSession`
// typed non-nullable so the closures below (samplers, `onState`) don't re-widen it to `undefined`.
const padiSession = ((): PadiSession => {
  const s = pool.getSession(encodeHostKey(defaultHost));
  if (s === undefined)
    throw new Error(
      `boot invariant violated: default host "${encodeHostKey(defaultHost)}" was seeded but has no pool session`,
    );
  return s;
})();

// `padiSession` is a `PadiSession` (a `DaemonSession<PadiSurfaceClient>`, from the
// local or remote arm's `makeSession` + spread); it plugs into `reServeSurface`'s loose
// `Session` receptacle checked (S3 dropped the dead contract `<C>` at the role
// boundary, so only the SURFACE spec is named here).
// Re-serve one host's padi surface on demand, CACHED per host — keyed by the CANONICAL
// STRING (`encodeHostKey`), never the `HostKey` object itself (a `Map`/`===` compares an
// object by reference, so two logically-equal `HostKey`s would never collide). `.done`
// enacts the #1708 pump-fault pins: the DEFAULT (local) host's pump death is FATAL
// (fail-fast — the supervisor restarts kolu-server clean); a GUEST host's death RETIRES
// just that host (`pool.retire` ends its map subs typed; the client's `hostReconcile`
// effect then switches `activeHost` off the departed host to the local default, so the
// canvas falls back with a toast rather than stranding the tab on a dead host). This uses
// `retire`, NOT `remove`: the pool sheds the dead host on its OWN initiative, which must
// not be confused with the user's explicit remove — so it does not persist the departure
// (a membership store re-seeds the host next boot). The map forwards each host's calls to
// `directLink(reServeFor(h, s).router)`.
const reServes = new Map<string, ReServedSurface<typeof padiSurface.spec>>();
const reServeFor = (
  h: HostKey,
  s: PadiSession,
): ReServedSurface<typeof padiSurface.spec> => {
  const enc = encodeHostKey(h);
  let r = reServes.get(enc);
  if (r === undefined) {
    r = reServeSurface<typeof padiSurface.spec>({
      source: padiSurface, // the BASE surface; reServeSurface adds `connection` internally.
      policy: PADI_FORWARDING_POLICY, // per-member value|delta forwarding.
      session: s,
      log: (line) => log.debug({ line, host: enc }, "padi re-serve"),
    });
    reServes.set(enc, r);
    r.done
      .then(() =>
        log.info(
          { host: enc },
          "padi re-serve pump exited (session destroyed)",
        ),
      )
      .catch((err) => {
        if (enc === encodeHostKey(defaultHost)) {
          log.fatal(
            { err, host: enc },
            "default padi re-serve pump died — binding is unrecoverable",
          );
          process.exit(1);
        }
        log.error(
          { err, host: enc },
          "guest padi re-serve pump died — retiring the host",
        );
        // `retire`, not `remove`: an internal shed, not a user removal — it tears the
        // host out of the live pool WITHOUT persisting, so a remembered host returns on
        // the next boot. `retire` has no persist step and swallows its own teardown
        // fault, so it can't reject — a bare `void` needs no `.catch` to stay off the
        // fatal `unhandledRejection` handler.
        void pool.retire(enc);
      });
  }
  return r;
};

// Evict a re-served mirror when its host leaves the pool (see `pruneToMembers` for the full
// stale-reserve-on-flap rationale): a guest remove→re-add of the SAME key must build a FRESH
// mirror, never the dead one still pinned to the destroyed session. `pool.subscribe` fires
// only after `has()` reflects the drop, so the slot is gone before any re-add can re-request
// it; the unremovable LOCAL host never leaves, so its eager mirror stays.
// On eviction, close() the dropped re-serve — abort its pump and release the
// supervised runtime's owned sources (SRT-PR1), rather than leaving them to the
// session-destroy GC race. close() is idempotent and resolves cleanly (the pump's
// own `done` still drives the retire/fatal observer above), so this fire-and-forget
// teardown changes no disposition — it just makes the release deterministic.
pool.subscribe(() =>
  pruneToMembers(
    reServes,
    (h) => pool.has(h),
    (r) => void r.close(),
  ),
);

// Eagerly re-serve the LOCAL (default) host so the memory sampler has its in-process
// client — a `directLink` over the mirror's own router, no socket/ssh hop. It reads
// padi's `{ padi, kaval }` off the value the re-serve already folds into its per-binding
// store, instead of opening a second transport to padi.
// `padiSession` (above) already holds the resolved LOCAL/default session — reuse it rather
// than re-looking it up + re-asserting non-null (defaultHost === LOCAL_HOST by construction).
const localReServe = reServeFor(LOCAL_HOST, padiSession);
const reServedPadiClient = surfaceClientRef(
  localReServe.surface,
  localReServe.router as Parameters<typeof surfaceClientRef>[1],
);

// Serve the padi MAP over the warm pool — the key-folded members + the `entries`
// membership collection, keyed by host. env-unset = a 1-member map = pixel-identical.
// The local arm is a non-provisioning `makeSession<_, never>` (padiBinding), typed
// without "copying"; `serveHostMap`'s belt (juspay/kolu#1716) checks that off each
// session's own `provisions` fact now, so there is no app-nominated "local key" to pass.
const padiMap = serveHostMap(padiHostMap, pool, {
  // biome-ignore lint/suspicious/noExplicitAny: ReServedSurface.router is opaque (`unknown`); directLink forwards it structurally, exactly as the memory sampler's `surfaceClientRef` does above.
  linkFor: (h, s) => directLink(reServeFor(h, s).router as any),
  // The clock offset is no longer injected: `makeSession` measures it off the
  // framework-reserved `system.clockNow` at admit and carries it on each session's
  // own `connected` state, which `serveHostMap` reads directly. Readiness is
  // LINK-liveness: the entry is `connected` the moment its link is live and carries
  // `clockOffset: null` through until the first probe stamps it — never demoted to
  // `connecting`.
  // D1 + D2: classify a DOWN session into the schema-valid `PadiEntryFailure` —
  // padi's own knowledge (`session.entryFailedDetail()`, derived from
  // `convergence()`/the drv-resolution fault, both arm-local), never guessed
  // generically by `serveHostMap` (a transport-only adapter). PR4: this is REQUIRED
  // and TOTAL — the classification lives in `padiFailureOf` (the ONE tested source of
  // truth): a finer arm-local detail pairs with the transport `reason`; a transient
  // `disconnected` with no detail keeps the entry warming (`null`, the single-meaning
  // absent); and a terminal give-up (`state.phase === "failed"`) that carries no finer
  // detail is classified off the ARM via `session.provisions` — a non-provisioning
  // (LOCAL) give-up is `local-start-failed` (its own named producer, distinct from the
  // remote arm's `link-failed`), a provisioning (remote) one is `link-failed` — rather
  // than yielding `null` into `serveHostMap`'s fail-loud `UnclassifiedHostFailureError`
  // seam. So a genuinely-failed entry always classifies.
  failureOf: (_host, session, state): PadiEntryFailure | null =>
    padiFailureOf(session.provisions, session.entryFailedDetail(), state),
});

// Splice the map's INNER surface object under the `padi` key beside kolu-server's own
// siblings. `serveHostMap` returns a top-level single-surface router
// (`{ surface: { <folded members>, entries } }`), so nesting its `.surface` under `padi`
// yields `/surface/padi/<folded-member>` + `/surface/padi/entries`, no double prefix.
// `padiMap.router` is typed `{ surface: … }` (PR3), so `.surface` reads cast-free — the
// router splice's old `as any` is now unspellable by type, closing the campaign's
// no-splice property WHOLLY in PR3 (contract cast + string keys + router cast).
const surfaceRouter = {
  surface: {
    ...koluSurfaceRouter.surface,
    [PADI_SURFACE_NAME]: padiMap.router.surface,
  },
};

const appRouter = buildAppRouter({
  surfaceRouter,
  // The re-targeted "restart": drain the DEFAULT bound padi (persist + exit; kaval + its
  // PTYs survive; the reconnect loop re-spawns padi). Never a kill-9.
  drainBoundPadi: () => padiSession.renew(),
  // Runtime pool membership (the selector strip's add/remove). `pool.add` uses the
  // pool's stored `buildEntry` — a guest host takes the remote ssh arm. `remove` fails
  // LOUD for the unremovable default (LOCAL_HOST / the boot default): the canvas must
  // always keep a host to fall back to, and "being able to override" is never a feature.
  addHost: (host) => pool.add(encodeHostKey(host)),
  removeHost: async (host) => {
    assertRemovableHost(host, defaultHost);
    await pool.remove(encodeHostKey(host));
  },
  // The host-down card's [Reconnect]: force the held session to RE-DIAL now via
  // `recheck()` (force-cycle the held connection through the reconnect loop). A
  // STANDING refuse (cross-supervisor / contract-skew / unconverged) holds degraded
  // WITHOUT auto-reconnecting, so once the operator clears the cause this is the only
  // recovery path short of remove+re-add. An unknown host is a loud throw (the strip
  // surfaces it as a rejected call), never a silent no-op.
  reconnectHost: (host) => {
    const s = pool.getSession(encodeHostKey(host));
    if (s === undefined)
      throw new Error(`cannot reconnect unknown host "${encodeHostKey(host)}"`);
    s.recheck();
  },
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
const PREVIEW_ROUTE_PATTERN = `${TERMINAL_FILE_ROUTE_BASE}/:host/:terminalId/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/*`;
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
  // The preview reads a per-HOST terminal's bytes, so the tab's active host rides
  // in the URL (`buildTerminalFileUrl`, as `encodeHostKey`'s canonical string) and we
  // resolve against THAT host's padi — not the local default. Without this, switching
  // to a remote host would ask the LOCAL padi about a remote terminal id (a 404, or
  // the wrong bytes on an id collision). Decode + re-validate the key through the
  // SAME codec + schema the map is keyed by (rejects a malformed segment → 400), then
  // find its warm session; a key that isn't a current pool member (an unseeded or
  // departed host) is a loud 404, never a silent fall-through to the default host.
  const rawHostParam = c.req.param("host");
  let host: HostKey;
  try {
    host = HostKeySchema.parse(decodeHostKey(rawHostParam));
  } catch {
    return c.text("invalid host key", 400);
  }
  const session = pool.getSession(encodeHostKey(host));
  if (!session) return c.text(`unknown host "${encodeHostKey(host)}"`, 404);
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
  const rawTail = previewTailFromRawUrl(rawTarget, rawHostParam, terminalId);

  // Which directory this terminal serves (its git repo root) — RE-SOURCED from
  // padi's registry over the SELECTED host's session, since padi (not kolu-server)
  // owns the terminal registry now. padi resolves terminal id → repoRoot; how
  // kolu-server then reads the bytes forks on the host (local disk vs. the remote
  // host), see below. Either way the file is never forced whole through the base64
  // procedure.
  const clientPromise = session.currentClient();
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
  // The byte read forks on the SELECTED host — but the file tail + repoRoot (and
  // their `..`/`%2f` defenses above) are identical for both arms, so a remote path
  // never reaches a local read, and vice versa.
  //   - REMOTE host: the file lives on the ssh HOST, so dial that host's padi
  //     `preview.read` in bounded chunks (`assembleRemotePreview`) — the RIGHT
  //     host's bytes, streamed back with an O(chunk) heap on both hops. padi
  //     re-enforces its realpath/403 guard host-side inside the read.
  //   - LOCAL default (`host.kind === "local"`): read THIS machine's disk directly via
  //     the shared streaming `previewFile` (the same underlying serve-dir read padi
  //     serves) — no hop, no base64 round trip, byte-identical to before.
  // Both return serve-dir's `ServeResult` shape; the artifact-sdk HTML decorator
  // (mounted above) rewrites text/html downstream in either case.
  let r: ServeResult;
  if (host.kind !== "local") {
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
    // first-frame-guard:allow — a genuine one-shot the primitive can't express: the
    // empty-stream case below returns a typed `PADI_MEMORY_READ_ERROR` sentinel and
    // logs a distinct line, a branch neither `firstFrameOrThrow` (throw) nor
    // `firstFrameOrUndefined` (undefined) can carry.
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
  koluSurfaceCtx.cells.padiLink.set(mapConnectionToPadiLink(s.phase));
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
    // Under ALWAYS-MAP the host this sampler describes is the unremovable LOCAL default
    // (`padiSession` binds it), so `boundHost` is null — a local bind. daemonInventory
    // derives `boundLocally = boundHost === null`, and the local default padi's
    // `hostInventory` member already covers this machine, so no duplicate `localScan` is
    // published. The per-host inventories of any guest hosts ride the map's members, not
    // this kolu-server-own sampler.
    boundHost: null,
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
