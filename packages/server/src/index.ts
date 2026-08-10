import {
  createServer as createHttpServer,
  type IncomingMessage,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { NodeHttpServer } from "@effect/platform-node";
import {
  artifactSdkBundleLayer,
  type SdkScriptPath,
  withArtifactSdk,
} from "@kolu/artifact-sdk/server";
import { startHeapDiagnostics } from "@kolu/heap-diag";
// The web shell reaches the terminal domain ONLY through @kolu/padi's published
// entry points (the package-boundary seal). Post-cutover it keeps the streaming
// preview read (`previewFile`, used by `iframePreviewRoute.ts`) and its own
// publisher size (a diagnostic); it no longer runs the terminal domain.
import {
  discoverPadiDaemons,
  probeKavalStatus,
  publisherSize,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
import {
  PADI_FORWARDING_POLICY,
  type PadiProcessMemory,
  padiSurface,
} from "@kolu/padi/surface";
import { directDispatch } from "@kolu/surface/links/direct";
import { surfaceClientRef } from "@kolu/surface/project";
import { gateWsOrigin, parseAllowedOrigins } from "@kolu/surface/ws-origin";
import { SURFACE_WS_PATH } from "@kolu/surface-app";
import {
  acceptSurfaceSocket,
  freshStaticLayer,
  pwaManifestLayer,
  serveSurfaceSocket,
} from "@kolu/surface-app/server";
import {
  buildRemotePool,
  type ReServedSurface,
  reServeSurface,
  serveHostMap,
} from "@kolu/surface-remote";
import { sessionConnection } from "@kolu/surface-remote/connection";
import { Cause, Effect, Layer, Option, Scope, Stream } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { discoverKavalDaemons, legacyKavalSocketPath } from "kaval";
import { getPendingSummaryFetches } from "kolu-claude-code";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import {
  type HostKey,
  LOCAL_HOST,
  type PadiEntryFailure,
  padiHostMap,
} from "kolu-common/surfacesWithPadi";
import { type WebSocket, WebSocketServer } from "ws";
import type { KoluBootFlags } from "./bootFlags.ts";
import { healthRouteLayer } from "./healthRoute.ts";
import { serverHostname, serverProcessId, serverVersion } from "./hostname.ts";
import { getPersistedHosts, savePoolMembership } from "./hostPersistence.ts";
import { koluHttpMiddleware } from "./httpMiddleware.ts";
import {
  PREVIEW_ROUTE_PATTERN,
  previewRouteHandler,
} from "./iframePreviewRoute.ts";
import { log } from "./log.ts";
import { enumerateDaemonInventoryOnce } from "./padi/daemonInventory.ts";
import { installNewTerminalPolicyPusher } from "./padi/newTerminalPolicy.ts";
import {
  ensurePadiBinding,
  handlePadiBootFailure,
} from "./padi/padiBinding.ts";
import { mapConnectionToPadiLink } from "./padi/padiLink.ts";
import { type PadiSession, padiFailureOf } from "./padi/padiSession.ts";
import {
  assertRemovableHost,
  ensureRemotePadiBinding,
  parseKoluPadiHostSeed,
} from "./padi/remotePadiBinding.ts";
import { pruneToMembers } from "./padi/reServeEviction.ts";
import {
  claimLocalSupervisor,
  supervisorConflictError,
} from "./padi/supervisorClaim.ts";
import { padiMemoryReadable } from "./padiMemoryGate.ts";
import { createKoluForwards } from "./portForward/forwards.ts";
import {
  makeHostPortsReader,
  type TerminalsFace,
} from "./portForward/hostPorts.ts";
import { makeViewerHostResolver } from "./portForward/resolveViewerHost.ts";
import { pwaIdentityForHostname } from "./pwaIdentity.ts";
import { buildAppRouter, CurrentViewer } from "./router.ts";
import {
  listServerStateBackups,
  restoreServerStateBackup,
} from "./stateBackups.ts";
import { stateBackupRing } from "./state.ts";
import {
  assembleServedHandlers,
  currentNewTerminalPolicy,
  implementKoluSurface,
  servedGroup,
} from "./surface.ts";
import { resolveTlsOptions } from "./tls.ts";

// The web face's boot contract (`KoluBootFlags`) lives in `bootFlags.ts` —
// the leaf `packages/kolu-cli`'s command tree also imports, so schema and
// contract can't drift. The PARSE lives in `packages/kolu-cli` (the composition
// root owning the `effect/unstable/cli` command tree —
// docs/atlas/src/content/atlas/kolu-cli.mdx); this package only receives the
// result via `bootKoluWeb`'s signature. Note the server is reached as
// `kolu web` now: bare `kolu` lists subcommands, and the bind address is
// `--bind` (`--host` names which padi a terminal verb talks to).

/** "Runs once per process" was mechanical while this was a top-level script
 *  (the module cache); the function form re-enforces it here — a second call
 *  would double-register the process-global signal/fatal handlers and
 *  double-boot, so it crashes loudly instead. */
let booted = false;

/** Boot the kolu web server — everything that used to be this module's
 *  top-level script, parameterized on the parsed flags. `packages/server`
 *  stopped being the bin at kolu-cli PR1: the `kolu` binary lives in
 *  `packages/kolu-cli`, whose `web` arm calls this. The returned promise
 *  resolves once the boot sequence has run; the server's live handles keep
 *  the process up, exactly as the script form did. Call-at-most-once (see
 *  `booted` above). */
export async function bootKoluWeb(flags: KoluBootFlags): Promise<void> {
  if (booted) throw new Error("bootKoluWeb called twice in one process");
  booted = true;

  const PWA_BACKGROUND_COLOR = "#0c0c0e";

  // CSWSH defense: extra browser origins (beyond same-origin) allowed to reach
  // the unauthenticated RPC surface at the `/rpc/ws` upgrade — the ONE transport
  // (the oRPC-era `/rpc/*` HTTP arm is gone, and with it `gateHttpRpcOrigin`).
  // Empty by default — loopback + same-origin is the common case; set
  // `KOLU_ALLOWED_ORIGINS` (comma-separated) for a reverse-proxy /
  // `tailscale serve` front-end whose browser origin differs from the `Host` it
  // forwards. See `gateWsOrigin` in the upgrade handler below.
  const allowedOrigins = parseAllowedOrigins(process.env.KOLU_ALLOWED_ORIGINS);

  // `--verbose` drops the server's logger to debug. padi runs in its OWN process
  // now: its daemon-spine stderr logger emits every level unconditionally, but its
  // DOMAIN code logs through `@kolu/padi`'s own pino logger (`packages/padi/src/log.ts`),
  // which filters at `LOG_LEVEL ?? "info"`. So `--verbose` alone would leave padi's
  // domain debug lines dropped (the split-process regression the pre-cutover
  // `padiLog.level = "debug"` guarded against). We forward the intent instead: the
  // binding launches padi with `LOG_LEVEL=debug` when verbose (see `daemonEnv` in
  // `padiBinding.ts`), the cross-process twin of raising that logger in place.
  if (flags.verbose) {
    log.level = "debug";
  }

  // The slow re-snapshot tick (#1658): `state.ts` took the boot snapshot at
  // module load (it must precede the `Conf` construction, which rewrites the
  // file); the daily tick is armed HERE instead, because "this process runs
  // long" is a boot fact, not an import fact — every unit test that imports
  // `state.ts` would otherwise arm a process-lifetime timer. padi's `daemonMain`
  // makes the same split, for the same reason. `unref`'d — disarming rides
  // process exit.
  stateBackupRing.startTicker();

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
  // (retrying can't make it go away), so — exactly like a `PadiBindingFatalError`
  // (adoption refusal #1313, vanished state root #2010)
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
  // provisioning, both take real time — each session publishes its honest fine phase
  // meanwhile: local starts at connecting; remote starts at probing). The `?host=` handler is unused (the
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
                nixShellWhitelist: flags.allowNixShellWithEnvWhitelist,
                legacyKavalSocket: legacyKavalSocketPath(flags.port),
                spawnVersion: serverVersion,
                verbose: flags.verbose,
                // A structurally-unresolvable verdict — an adoption refusal, or the
                // state root deleted under a live server (#2010) — is fatal on ANY
                // dial, not just the boot pin's first one below: a reconnect's own
                // fire-and-forget loop would otherwise swallow a LATER verdict
                // silently (see the option's doc in padiBinding.ts). Wired to the
                // SAME handler the boot pin's catch uses, so a first-dial and a
                // later-dial verdict fail identically.
                onFatalBindingError: (err) =>
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
  // ONE exception class, handled by `handlePadiBootFailure`: a `PadiBindingFatalError`
  // is structurally UNRESOLVABLE — an adoption refusal (a resident padi owns this
  // state root at a contract skew #1313 forbids touching) or a vanished state root
  // (the workspace deleted out from under this server, #2010) — retrying forever
  // would just be a silent spinner behind the fail-open UI, which the boot acceptance
  // bar forbids, so those exit loudly instead, naming the conflict + the remedy the
  // error already composed.
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
        // CHATTER at debug (reconnects, link ends) — filtered in production, and
        // that is fine because it is no longer the only channel. FAULTS ride
        // `onFault` at ERROR level: a projection-layer death used to reach this
        // `log.debug` alone, which production drops, so the deploy-#2 freeze
        // produced not one line (juspay/kolu#2101 G5).
        log: (line) => log.debug({ line, host: enc }, "padi re-serve"),
        onFault: (fault) =>
          log.error(
            {
              err: fault.err,
              host: enc,
              member: fault.label,
              scope: fault.scope,
            },
            fault.scope === "key"
              ? "padi projection: a collection key stopped being mirrored (key-local; the host mirror is still live)"
              : "padi projection: a mirrored member's upstream stream died — the mirror is dead",
          ),
      });
      reServes.set(enc, r);
      r.done
        .then(() =>
          // A CLEAN resolve means what it says again, now that an upstream fault
          // rejects instead (#2101 G5): every subscription ended without failing.
          // Over one link that is the session going away or a supervised close —
          // so this line no longer has to guess at "session destroyed" as the
          // cause of what might have been a silent death.
          log.info(
            { host: enc },
            "padi re-serve ended cleanly (link closed or supervision stopped)",
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
    localReServe,
  );

  // Serve the padi MAP over the warm pool — the key-folded members + the `entries`
  // membership collection, keyed by host. env-unset = a 1-member map = pixel-identical.
  // The local arm is a non-provisioning `makeSession<_, never>` (padiBinding), typed
  // without "copying"; `serveHostMap`'s belt (juspay/kolu#1716) checks that off each
  // session's own `provisions` fact now, so there is no app-nominated "local key" to pass.
  const padiMap = serveHostMap(padiHostMap, pool, {
    // The per-host forwarding target: an in-process dispatch straight over that
    // host's re-served handler record — no socket, no serialization. `directDispatch`
    // takes the `{ handlers }` pair the re-serve hands back, so this connection site
    // is cast-free (the oRPC `router as any` it replaces existed only because a
    // nested router proxy had no nameable type).
    dispatchFor: (h, s) => directDispatch(reServeFor(h, s)),
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
    // SR9 — the entry's fine `connection` payload (the word), co-produced with the coarse dot
    // from the SAME frame in `serveHostMap.resolve`. `project` is the shared `sessionConnection`
    // total projection (folds the gate-closed `connecting` for a not-yet-seeded member);
    // `isConnected` is padi's connected-discriminant, which serveHostMap asserts AGAINST the
    // coarse dot — so a "connected dot, connecting word" pair fails loud before publication
    // (drishti#102 made structurally unspellable, not merely a convention).
    connection: {
      project: sessionConnection,
      isConnected: (c) => c.phase === "connected",
    },
  });

  // ── SR8.a: serve kolu-server's OWN surface HERE, after padiSession ───────
  //
  // kolu-server's own two siblings (kolu + surfaceApp) are served NOW — in the async
  // boot, after `padiSession` exists — not at `surface.ts` module load. The reason is
  // the two DERIVED poll cells below: their read + install seams (`readPadiMemoryOnce`
  // off the re-serve mirror, the padi-identity closures, and `padiSession.onState`) all
  // exist only here. Serving is a single straight-line call whose returned router/ctx
  // are used immediately (the splice + the onState wiring), so the rejected late-bind
  // registrar slot (an override-knob) is unnecessary — control flow IS the fail-fast.

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
  // padi process now, so padi (not kolu-server) is the source of that pair; the
  // `processMemory` poll cell folds it in below.
  function readPadiMemoryOnce(): Effect.Effect<PadiProcessMemory | null> {
    // LIVENESS GATE — read padi's HONEST published phase, not `currentClient()`. The
    // reactor defers this poll read a microtask; `padiSession.currentState()` returns the
    // freshest connection frame (the same value `onState` publishes), so the deferred read
    // sees the true phase at the read instant. Only `connected` means the mirror holds a
    // live reading; every up-but-not-connected phase (connecting/probing/…) and every down
    // phase (disconnected/failed) folds to the honest `absent` (`null`), the gate — not the
    // held store — deciding down-ness.
    //
    // This TIGHTENS the old `currentClient() !== null` gate, which meant "dialing-OR-
    // connected": it read truthy through `connecting` AND — because `scheduleReconnect`
    // retains the rejected `clientPromise` across the backoff wait — through entire
    // reconnect backoff windows, republishing the mirror's held stale RSS the whole time.
    // Reading the phase closes that: liveness is now `phase === "connected"`, which is app
    // POLICY (`padiMemoryReadable`: "a live reading exists only when connected AND not
    // destroyed"), named as such — no accessor pointer stands in for it. A fresh rebind still
    // has one bounded fold cycle where the mirror hasn't re-folded the newest reading yet
    // (Ledger L14, orthogonal to the gate).
    //
    // The whole gate — the phase-tightening AND the `isDestroyed()` fold (the frame can't
    // carry destroyed-ness; see `padiMemoryReadable`'s module doc) — is the named leaf now, so
    // the mirror read below can't run against a destroyed re-serve.
    if (!padiMemoryReadable(padiSession)) return Effect.succeed(null);
    return Effect.gen(function* () {
      // `reServedPadiClient` is an in-process `directDispatch` face over the mirror's
      // handlers, so this reads the folded store with no socket/ssh hop and the same
      // cell verb. A cell `get` is a lazy `Stream` now (D10/#18): `Stream.runHead`
      // takes the snapshot frame and INTERRUPTS the rest, which is the Effect
      // successor of the old `AbortController` + `firstFrameOrUndefined` pair —
      // fiber interruption IS the unsubscribe, so nothing is left running.
      const frame = yield* Stream.runHead(
        reServedPadiClient.surface.processMemory.get(undefined),
      );
      // The client was live but the cell yielded no frame — an operational anomaly,
      // not "no process to measure". Report `error`, not `absent`, and log at `error`
      // (a live-client read that produced nothing is a failed read, not a degraded-but-
      // recoverable state — see `.agency/code-police.md` errors-must-log-at-error).
      if (Option.isNone(frame)) {
        log.error({}, "padi memory read yielded no frame through the mirror");
        return PADI_MEMORY_READ_ERROR;
      }
      return frame.value;
    }).pipe(
      // padi was BELIEVED up (a live client) yet the mirror read failed — surface the
      // honest `error` state, distinct from `absent`, rather than collapsing a caught
      // error to the empty "no process" reading. padi's liveness still rides the
      // re-serve's own `connection` cell; this only affects the memory rail's three-way
      // readout. A caught read failure is a real error, not `warn`
      // (errors-must-log-at-error). `catchCause` rather than `catch`, so a DEFECT in the
      // mirror read degrades this one cell too instead of faulting the poll.
      Effect.catchCause((cause) => {
        log.error(
          { err: Cause.squash(cause) },
          "padi memory read failed through the mirror",
        );
        return Effect.succeed(PADI_MEMORY_READ_ERROR);
      }),
    );
  }

  // Map the base `session.identity()` sum onto the daemon-inventory readouts the dialog
  // reads (uptime · contract version · navigable commit). `identity()` is TOTAL
  // (disconnected | anonymous | identified); padi always DECLARES its build, so a bound
  // padi is always `identified`, a mid-reconnect gap is `disconnected` (never
  // `anonymous`). `padiStartedAt` also feeds the `processStartedAt` cell off `onState`
  // below; `padiSurfaceVersion`/`padiBuildCommit` feed the `daemonInventory` poll cell.
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

  // The daemon-inventory poll read — TOTAL, mirroring `readPadiMemoryOnce` and the sibling
  // `processMemory` read. `enumerateDaemonInventoryOnce` is NOT total (a remote-arm discovery
  // fs-walk or a session readout can throw), and a poll source's T+0 SEED throw faults the
  // runtime's `done` → `process.exit(1)` (`surface.ts`'s fatal policy) — crashing the whole
  // web shell (terminal serving included) over a purely diagnostic panel, where the retired
  // `startDaemonInventorySampler`'s first tick was non-fatal (its `.catch` covered every tick
  // including the seed). So catch here: a structured `log.error` (the reactor's own poll
  // catch is a bare `console.error`, no serverId/cell tag) and the honest empty default, so an
  // enumeration fault degrades this one cell instead of the process — the same "make the read
  // total" discipline the sibling `readPadiMemoryOnce` follows. Enumeration is designed not to
  // throw, so this is defence in depth.
  // The RAW host-daemon enumeration — what only kolu-server knows (the binding host, its
  // own-machine scan under a remote binding, the bound padi's identity + convergence). Its
  // readouts ride `padiSession`, so it's built here and passed as a domain dep;
  // `implementKoluSurface` wraps it TOTAL (one home for the guard, beside the cell build).
  const readDaemonInventoryEffect = () =>
    enumerateDaemonInventoryOnce({
      discoverKavals: discoverKavalDaemons,
      discoverPadis: discoverPadiDaemons,
      probe: probeKavalStatus,
      activePadiSurfaceVersion: () => padiSurfaceVersion(),
      activePadiBuildCommit: () => padiBuildCommit(),
      activePadiConvergence: () => padiSession.convergence(),
      // Under ALWAYS-MAP this describes the unremovable LOCAL default (`padiSession` binds
      // it), so `boundHost` is null — the local default padi's `hostInventory` member
      // already covers this machine, so no duplicate `localScan`.
      boundHost: null,
    });

  /**
   * THE reactor-poll Promise edge, named once (governance:
   * `packages/tests/governance/runEdges.ts`).
   *
   * A poll cell's dep is `read: () => Promise<T>` and the reactor is deliberately
   * non-Effect (locked decision 1; B4a H1) — its `connectPoll` is public and has a
   * consumer outside any wire member, so converting the read would put an
   * `Effect.runPromise` inside `reactor.ts` instead of here. kolu-server's two poll
   * READS are Effect-native (a mirror stream read; an enumeration that dials every
   * local kaval), so this is where they meet that seam — one function, so the
   * boundary is countable rather than one crossing per cell.
   *
   * It takes a THUNK, not an effect: `readPadiMemoryOnce` reads the liveness gate
   * SYNCHRONOUSLY before it builds anything, so a single effect value captured at
   * wiring time would freeze that gate at boot. One `Effect` per read, exactly as one
   * `Promise` per read before it.
   *
   * Totality is the CALLER's, and both callers have it: the memory read folds every
   * failure to its honest `error` reading, and the inventory read is wrapped TOTAL by
   * `implementKoluSurface` beside the cell it feeds. A poll seed needs that — a T+0
   * seed rejection faults the runtime's `done` → `process.exit(1)`.
   */
  const pollRead =
    <A>(program: () => Effect.Effect<A, unknown>): (() => Promise<A>) =>
    () =>
      Effect.runPromise(program());

  // ── Port forwards (PRT2) ────────────────────────────────────────────────
  //
  // kolu-server EMBEDS `@kolu/port-forward`: the doors are listeners in THIS
  // process, so they die with it — which is the property the whole design was
  // chosen for, and the reason there is no forwarding daemon to supervise. A
  // deploy restarts kolu, the kernel closes every listener, and the restarted
  // Inspector's empty list is the truth rather than an orphaned lie.

  /** The forward reaper's port reading, over this host's re-serve mirror. The
   *  reader itself lives in `portForward/` — this only hands it the padi seam. */
  const readHostPorts = makeHostPortsReader({
    log,
    terminalsOf: (host) => {
      const session = pool.getSession(encodeHostKey(host));
      if (session === undefined) return null;
      const served = reServeFor(host, session);
      // `surfaceClientRef` types its result as the spec's READ face, which
      // deliberately DECLINES collections (it exists for a projection's `deps`,
      // which never walks one) — while the runtime face `buildSurfaceFace` mints
      // carries every member, `terminals` included. So the member is reached
      // structurally, the ONE place kolu-server does so, and the shape it is read
      // AT (`TerminalsFace`) states the two verbs with bivariant methods so a
      // `keys`/`get` rename upstream is still a compile error where they are
      // called. Same deliberate structural gap padi's own dial spells out.
      const face = surfaceClientRef(served.surface, served)
        .surface as unknown as {
        terminals: TerminalsFace;
      };
      return face.terminals;
    },
  });

  /** The forward map + kolu's policy over it. Its `subscribe` is the cell's
   *  fused change EDGE — a bare tick that makes the poll re-read at once — so an
   *  act reaches the wire without waiting out the reap interval. Nothing here
   *  holds a copy of the list: the cell's read is its only reader. */
  const forwards = createKoluForwards({
    readHostPorts,
    hostIsMember: (host) => pool.has(encodeHostKey(host)),
    log,
  });

  // A host leaving the pool takes its doors with it — a forward to a machine kolu
  // no longer has is a door to nowhere, and that holds for `manual` forwards too
  // (the one thing besides an explicit cancel that may close one). This is pool
  // MEMBERSHIP, not link liveness: a flapping ssh connection must not reap
  // anything, and it does not need to — a remote forward's ssh child dies with its
  // own connection and the map hears about it through `onLost`.
  pool.subscribe(() => {
    // Once per departed HOST. Walking the forwards and firing per row meant
    // three doors on one machine started three concurrent `hostDeparted` runs
    // over the same keys, and the losers logged a cancel failure for every key
    // the winner had already taken down — noise shaped exactly like a fault.
    // `heldHosts`, not `list`: a host whose only door is still OPENING holds
    // no listable forward yet, so walking the list made it look like a host with
    // no doors and `hostDeparted` was never called for it — leaving the very
    // in-flight door that function now knows how to cancel.
    for (const host of forwards.heldHosts()) {
      if (!pool.has(encodeHostKey(host))) void forwards.hostDeparted(host);
    }
  });

  /** "Which of kolu's hosts is this browser at?" — resolver in `portForward/`;
   *  this supplies the pool membership it walks. */
  const viewerHost = makeViewerHostResolver({ hosts: () => pool.hosts() });

  // The new-terminal THEME POLICY pusher (#2045). padi resolves every new terminal's
  // theme now — for the browser, the CLI, and an MCP agent alike — but it knows nothing
  // about preferences, so kolu-server derives the resolved policy off its own
  // `preferences` + `viewerMode` cells and writes it into each bound padi's memory-only
  // cell whenever that padi's link turns honest-`connected` (first bind AND every
  // reconnect). Installed BEFORE `implementKoluSurface` because its `republish` is the
  // surface's `onPolicyInputsChanged` nudge; it awaits nothing, so the boot invariant
  // asserted just below still holds.
  const newTerminalPolicyPusher = installNewTerminalPolicyPusher({
    pool,
    getPolicy: currentNewTerminalPolicy,
    log,
  });

  // Serve kolu-server's own surface. SR8.c: `implementKoluSurface` builds EVERY member from
  // these plain domain deps — index.ts imports no reactor primitive, and no member is
  // ctx-written (the reactor graph is each one's writer). The `onState` dep projects each
  // bound-padi `SessionState` into the rail payload the PUSH cells (`padiLink` /
  // `processStartedAt`) derive from — `phase → link` (`mapConnectionToPadiLink`), the honest
  // padi boot time off `identity()` (`padiStartedAt`); it ALSO drives the two POLL cells'
  // fused cadence (a bare tick that ignores the payload). `onState` fires the current state
  // synchronously on subscribe, so each member's seed reflects the live binding.
  //
  // SEED INVARIANT, ENFORCED (SR8.c): `processStartedAt` seeds from the static
  // `{ padi: null }` and — because the two push cells share ONE ref-counted `onState`
  // source, and a second `scan` subscriber doesn't replay the install-time frame — that
  // seed is only correct while padi is still WARMING here. The local `pin()` above is
  // fire-and-forget (never awaited), so the dial cannot have completed and `padiStartedAt()`
  // is `null`. This is index.ts's ordering to keep, so index.ts asserts it: a future change
  // that awaits the pin before this point would seed the uptime rail stale until the next
  // event — crash loudly at boot instead of shipping that silent staleness (fail-fast; the
  // fix then is to seed both cells from a live snapshot, not to relax this).
  if (padiStartedAt() !== null) {
    throw new Error(
      "kolu boot invariant violated: padi must still be warming (padiStartedAt null) when " +
        "implementKoluSurface runs — a pin() was awaited before the surface build, so " +
        "processStartedAt would seed stale. Seed the push cells from a live snapshot instead.",
    );
  }
  const koluServed = implementKoluSurface({
    readPadiMemory: pollRead(readPadiMemoryOnce),
    readDaemonInventory: pollRead(readDaemonInventoryEffect),
    onState: (cb) =>
      padiSession.onState((s) =>
        cb({
          link: mapConnectionToPadiLink(s.phase),
          padiStartedAt: padiStartedAt(),
        }),
      ),
    forwards: {
      // Reconcile, then report — ONE call, so the list that reaches the wire has
      // already had its dead doors closed. It is one call rather than a reap
      // followed by a read for a reason paid for in production: when the reap
      // announced its own result on `onChange`, and `onChange` is this read's own
      // trigger, a single live `auto` forward spun the event loop forever. TOTAL
      // by construction — `reconcile` logs and continues past every failure, and
      // the list is an in-memory map — so this poll's seed cannot throw and take
      // the runtime's `done` with it.
      read: forwards.reconcile,
      onChange: forwards.subscribe,
      create: forwards.create,
      cancel: forwards.cancel,
    },
    // A policy input moved (a theme preference, or a browser reporting its OS mode):
    // re-derive and re-push to every connected padi, so the next terminal any face
    // opens follows the setting the user just changed.
    onPolicyInputsChanged: () => newTerminalPolicyPusher.republish(),
  });

  // The ROOT procedures — kolu-server's own seven, bound as the third served
  // fragment. There is no router SPLICE any more: the wire namespace is flat, so the
  // padi map's members already carry their own `surface/padi/*` tags and the
  // assembly below is a handler-record merge whose route-set identity is asserted.
  const rootServed = buildAppRouter({
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
        throw new Error(
          `cannot reconnect unknown host "${encodeHostKey(host)}"`,
        );
      s.recheck();
    },
    // The skew card's [Update & restart kaval] (SK5): drain THIS host's padi via
    // the binder-owned `renew()` — padi persists + exits, the reconnect loop
    // re-dials (re-realising the CURRENT closure on the host — `resolveDrvPath`
    // runs fresh at the top of every dial), and the new padi's converge policy
    // recycles the old kaval from its new build. One seam for local and remote
    // alike (D1): the local session is a pool member exactly like a remote one.
    // An unknown host is a loud throw, never a silent no-op.
    viewerHost,
    renewHostDaemon: (host) =>
      Effect.suspend(() => {
        const s = pool.getSession(encodeHostKey(host));
        if (s === undefined)
          throw new Error(
            `cannot renew daemon on unknown host "${encodeHostKey(host)}"`,
          );
        return s.renew();
      }),
    // The state-backup ring (#1658). Restore drives the two Conf-backed cells'
    // server-internal writers (returned by `implementKoluSurface` above) and
    // converges the pool through the SAME add/remove path the strip's
    // `hosts/add`/`hosts/remove` take — the pool stays membership's one writer.
    listStateBackups: listServerStateBackups,
    restoreStateBackup: (input) =>
      restoreServerStateBackup(input, {
        ...koluServed.storeCellWriters,
        currentHostKeys: getPersistedHosts,
        // `getHandler` is the documented membership probe — entry presence,
        // never the handler's own value.
        hasLiveHost: (key) => pool.getHandler(key) !== undefined,
        addHostKey: (key) => pool.add(key),
        removeHostKey: (key) => pool.remove(key),
      }),
  });

  // --- The served surface: one group, one handler record ---------------------
  //
  // `servedGroup` (static, asserted tag-complete at import in `surface.ts`) is the
  // superset kolu-server advertises; `assembleServedHandlers` merges the three
  // fragments that implement it and PROVES the bound tag set matches the group
  // exactly, in both directions. A tag carries its own route, so there is no
  // router to assemble and no matcher tree to keep in sync — the boot-time 404 the
  // retired `implement(servedContract)` widening guarded against is now a crash
  // here, before the server listens.
  const servedHandlers = assembleServedHandlers({
    kolu: koluServed,
    padiMap,
    root: rootServed,
  });

  // NOTE — the HTTP RPC arm is GONE, deliberately. oRPC served every procedure on a
  // second, request/response transport at `/rpc/*`; Effect RPC has no such arm in
  // this stack — every call (a cell subscription, a collection delta stream, an
  // imperative procedure) rides the one ndjson socket at `/rpc/ws`, which is the
  // only transport kolu's own UI ever used. Keeping an empty `/rpc/*` route would
  // advertise a transport that answers nothing, so it is deleted rather than
  // ported — and with it the `gateHttpRpcOrigin` CSWSH gate, whose whole reason for
  // existing was that oRPC's HTTP codec was browser-reachable with no preflight.
  // Deleting the transport removes that attack surface outright instead of gating
  // it. The ws-upgrade gate (`gateWsOrigin`, below) is untouched and still
  // load-bearing. Same call the surface examples made in W2.

  // --- The HTTP app: ONE composed router layer --------------------------------
  //
  // Every route kolu-server serves is an `HttpRouter` layer, merged here and
  // turned into a node request handler at the listen site below. Registration
  // ORDER carries no meaning any more: the router ranks by SPECIFICITY, so the
  // literal `/api/health`, the parameterised preview pattern and static's `/*`
  // catch-all each win where they should whatever order they were merged in.
  // (Under hono the preview route had to be registered before the static
  // catch-all or `serveStatic`'s `/*` shadowed it; that ordering constraint died
  // with hono.)

  /** Where the in-iframe artifact-sdk bundle is served AND the `src` the HTML
   *  decorator injects — one constant, so the route and the tag cannot drift. */
  const SDK_SCRIPT_PATH: SdkScriptPath = "/api/artifact-sdk.js";

  // surface-app owns manifest assembly + the install-friendly defaults
  // (start_url, display); kolu supplies the per-host branding.
  const pwaIdentity = pwaIdentityForHostname(serverHostname);

  // The client bundle, when there is one. In DEV there is not (`just dev` runs
  // Vite, which proxies `/api`, `/manifest.webmanifest` and `/rpc` here), so the
  // static layer is simply absent and an unmatched path 404s through the
  // router's own `RouteNotFound` — which is exactly what `ci::dev-smoke` proves.
  const clientDist = process.env.KOLU_CLIENT_DIST;

  const appLayer = Layer.mergeAll(
    // `/api/health` — the liveness probe four independent consumers freeze; see
    // `healthRoute.ts` for the list. Deliberately dependency-free, so it answers
    // the moment the handler is attached.
    healthRouteLayer,

    // The artifact-sdk (comments-on-files) bundle bytes: esbuild'd at first
    // request, cached, hash-keyed via `?v=<hash>` so the immutable cache-control
    // is honest.
    artifactSdkBundleLayer({ sdkScriptPath: SDK_SCRIPT_PATH }),

    // The iframe preview byte route — repo files referenced by
    // `FsReadFileOutput.kind === "binary"`. The URL contract (base + builder +
    // parser), the `..`/`%2f` guards and every refusal status live in
    // `iframePreviewRoute.ts`; the composition root supplies only the host pool
    // and the logger.
    //
    // DECORATED with `withArtifactSdk`, and that decoration is REQUIRED: it
    // splices the SDK `<script>` into a `text/html` preview so comments-on-files
    // works inside the iframe. It is applied HERE rather than inside the route
    // because it is kolu's product decision, not the byte route's — artifact-sdk
    // exports a handler combinator now, since a router that scopes middleware
    // per LAYER (never per path prefix) has no successor to hono's prefix glob.
    // Drop it and everything still compiles and every unit test still passes,
    // while the in-iframe SDK silently never loads; `code-tab.feature:1538,1561`
    // and `file-ref-link.feature:209-219` are the only things that would catch
    // it.
    HttpRouter.add(
      "GET",
      PREVIEW_ROUTE_PATTERN,
      withArtifactSdk(SDK_SCRIPT_PATH)(previewRouteHandler({ pool, log })),
    ),

    // --- Dynamic PWA manifest (includes hostname) ---
    // Served UNCONDITIONALLY — in dev the Vite proxy forwards
    // `/manifest.webmanifest` here, so it must exist with no built client. That
    // is why kolu composes the two granular surface-app layers by hand instead
    // of taking `surfaceAppLayer`, which pairs the manifest with the dist.
    pwaManifestLayer({
      name: pwaIdentity.name,
      // `...extra` passthrough in pwaManifestLayer carries these through to the
      // served manifest — they upgrade Chromium's native install card (and the
      // pwa-install preview) from a bare icon to a richer app entry.
      description:
        "Real terminals on an infinite canvas — run any coding agent, pin it as an app, reach it from anywhere.",
      // Deep-link PWA capture: an in-scope https link (`#/t/…`, `#/h/…`, …) focuses
      // the ALREADY-OPEN installed window and hands the URL to the app's
      // `launchQueue`, instead of spawning a second window. Rides the `...extra`
      // passthrough (a plain manifest key — no surface-app change). See the
      // deep-links Atlas note + `useDeepLinks`.
      launch_handler: { client_mode: "focus-existing" },
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
    }),

    // --- Static files (production) ---
    // surface-app's freshness contract on the wire: no-store shell, immutable
    // hashed `/assets/*`, 404 on an asset miss (never the HTML shell), the `/sw.js`
    // worker, and the SPA fallback. `serviceWorker: "notify"` serves the fetch-less
    // notification worker (kolu fires agent-finished alerts via
    // `ServiceWorkerRegistration.showNotification()`, the only notification path
    // that works in an installed PWA). Pairs with `registerServiceWorker()` in the
    // client's `index.tsx`.
    clientDist
      ? freshStaticLayer({ root: clientDist, serviceWorker: "notify" })
      : Layer.empty,
  );

  // (SR8.c: `padiLink` + `processStartedAt` are now PUSH-source derived cells scanning the
  // bound padi's `onState` inside `surface.ts` — the reactor graph is their one writer, so
  // the hand-rolled `onState` → `ctx.set` handler that used to live here is retired.)

  // --- TLS setup ---
  const tlsOptions = await resolveTlsOptions(flags);

  // `bind` is the flag's name (`kolu web --bind`); `host` stays the local name
  // because that is the key `server.listen` takes.
  const { bind: host, port } = flags;

  // --- Start server ---
  // kolu-server OWNS the node `http(s).Server` and hands its `request` event an
  // Effect handler, instead of letting `HttpServer.serve` own the listener. That
  // ownership is what leaves the `upgrade` event to the ws seam below: node fans
  // an event out to EVERY listener, so a framework-installed upgrade listener
  // would ALSO run the http app for a socket we have already upgraded and write
  // a 404 into it. The ws seam must stay the ONLY `upgrade` listener here.
  const server = tlsOptions
    ? createHttpsServer(tlsOptions)
    : createHttpServer();

  // The handler's scope is the PROCESS's: this server serves until the process
  // ends, and the fatal boundary above (never a scope close) is what ends it.
  // `makeHandler` forks each request as a fiber IN this scope, so no in-flight
  // request is orphaned by a narrower lifetime.
  const httpScope = Scope.makeUnsafe();
  server.on(
    "request",
    // The http stack's ONE run edge (governance: `packages/tests/governance/
    // runEdges.ts`). `bootKoluWeb` is an orderly async function (locked decision
    // 1) and node's `request` event takes a plain callback, so turning the
    // composed layer into that callback is a genuine process edge.
    await Effect.runPromise(
      Effect.gen(function* () {
        const httpEffect = yield* HttpRouter.toHttpEffect(appLayer);
        return yield* NodeHttpServer.makeHandler(httpEffect, {
          scope: httpScope,
          // pino stays the sink. `koluHttpMiddleware` is the successor to BOTH
          // hono pieces this replaced: `app.onError` (log every uncaught route
          // fault, then answer 500) and `hono-pino` (one debug line per request
          // and response). Scoped to the HTTP surface deliberately — see
          // `httpMiddleware.ts` for why not a process-wide `ErrorReporter`.
          middleware: koluHttpMiddleware(log),
        });
      }).pipe(
        Scope.provide(httpScope),
        // The platform services the static layer asks for: file system, path,
        // the file-response platform, ETags.
        Effect.provide(NodeHttpServer.layerHttpServices),
      ),
    ),
  );

  server.listen({ host, port }, () => {
    const protocol = tlsOptions ? "https" : "http";
    const bound = server.address();
    // The `listening` callback fires with the socket bound, and kolu only ever
    // binds TCP — a `null` or a string (unix socket) here means the boot's own
    // assumption broke, so say so rather than log a lie about where the server
    // is reachable.
    if (bound === null || typeof bound === "string") {
      throw new Error(
        `kolu listening on a non-TCP address (${JSON.stringify(bound)}) — expected a bound host/port`,
      );
    }
    log.info(
      {
        version: serverVersion,
        pid: process.pid,
        node: process.version,
        rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
        address: `${protocol}://${bound.address}:${bound.port}`,
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
  });

  // --- The WebSocket RPC mount (the ONE transport) ---
  const wss = new WebSocketServer({ noServer: true });
  // The acceptance seam (`@kolu/surface-app/server`) owns the liveness reaper AND
  // sequences the per-socket stale-tab gate → reaper enrolment → dispatch in one
  // `accept(...)` call. Reaping the server-side zombie (and its stream
  // subscriptions) a half-open client would leak is the server half; the client
  // half (the watchdog folded into `createServerLifecycle`) un-freezes the tab.
  // The stale-tab gate closes a tab bound to a PREVIOUS instance BEFORE any RPC
  // dispatch (so dead-terminal subscriptions never replay and storm the logs) and
  // such a socket never enrols — so #1231's gate is untouched. The gate takes no
  // id from here: it compares against this process's own `surfaceProcessId()`,
  // which is exactly what the reserved `system/identity` member answers and so
  // exactly what a reconnecting tab echoes back (`serverProcessId` in
  // `./hostname` IS that value — the log line and the wire name one process).
  //
  // This is the HAND-WIRED ws seam PLAN D5/#6/#15 requires, and it is why the
  // turnkey `RpcServer.layerProtocolWebsocket` / `layerHttp` paths are NOT used:
  // both OWN the upgrade, and owning the upgrade means owning the ordering these
  // three steps must run in front of. The upgrade stays here — a raw
  // `server.on("upgrade")` + `ws.WebSocketServer` — so the CSWSH origin gate runs
  // before a socket exists, the stale-tab gate runs before any dispatch, and the
  // ping/terminate reaper holds every socket it will later sweep (all three need
  // the RAW `ws` socket, which Effect's `HttpServerRequest.upgrade` wraps away
  // behind `Socket.fromWebSocket`).
  const acceptor = acceptSurfaceSocket({
    server: wss,
    onError: (err) => log.error({ err }, "ws error"),
    onReject: (claimedPid) =>
      log.info(
        { claimedPid, serverProcessId },
        "rejecting stale client — server restarted since it last connected",
      ),
  });

  let nextConnId = 0;
  wss.on("connection", (ws: WebSocket, req: IncomingMessage, url: URL) => {
    const connId = ++nextConnId;
    const connLog = log.child({ ws: connId });
    // `accept` gates (stale-tab) → enrols in the reaper → runs our dispatch. A
    // stale tab is closed and never dispatched or enrolled.
    acceptor.accept(ws, url, () => {
      connLog.info({ total: wss.clients.size }, "connected");
      // H2 (juspay/kolu#2101): a waking laptop's FIRST observable act is its browser
      // reconnecting — so that signal fast-forwards every down host's already-scheduled
      // probe instead of leaving it to a wait of up to the 60s backoff cap. No phase
      // filter here: the filter IS the verb (`nudge()` no-ops on a live link, an
      // in-flight dial, and a terminal `failed`, and never refills the give-up budget —
      // unlike `recheck()`), so a wake storm across N tabs coalesces to one dial per host.
      for (const h of pool.hosts()) pool.getSession(h)?.nudge();
      // DISPATCH — the third and last step of the seam's gate → enrol → dispatch
      // order. `serveSurfaceSocket` stands up an Effect `RpcServer` for THIS socket
      // over the SHARED handler record: one Layer-composed serving stack per
      // connection (ndjson over the accepted websocket), so one peer's teardown
      // cannot touch another's.
      const serving = serveSurfaceSocket({
        group: servedGroup,
        handlers: servedHandlers,
        // A `ws` socket satisfies `ServableSocket` structurally; its typings
        // narrow `addEventListener` per event name, which the seam's generic
        // `(type: string, listener: (e: Event) => void)` shape cannot express.
        socket: ws as unknown as Parameters<
          typeof serveSurfaceSocket
        >[0]["socket"],
        // The viewer's connection facts, provided as this connection's OWN service
        // — the shape review #15 forced. Effect's socket-server RPC protocol
        // forwards no per-request context and no headers (`makeProtocolSocketServer`
        // calls `run(onSocket)` with the socket alone), so a per-caller fact cannot
        // ride the request; a per-connection serving stack simply PROVIDES it.
        // BOTH the direct peer and the forwarded header, because behind a reverse
        // proxy they name different machines; `viewerHost` gates which to believe.
        // An absent address stays an honest `undefined` — never a guess.
        services: Layer.succeed(CurrentViewer)({
          viewerAddress: req.socket.remoteAddress,
          forwardedFor: req.headers["x-forwarded-for"]?.toString(),
        }),
      });
      // `done` MUST be observed (the seam's contract): it rejects if this
      // connection's serving stack failed to build, and an ignored rejection is an
      // unhandled one — which the process-level `unhandledRejection` boundary would
      // turn into a whole-server exit over ONE dead socket. A per-connection fault
      // is per-connection: log it loudly and let the socket die.
      serving.done.catch((err: unknown) =>
        connLog.error({ err }, "ws rpc serving stack faulted"),
      );
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
    if (url.pathname === SURFACE_WS_PATH) {
      // CSWSH gate: reject a cross-site browser Origin before a socket exists at
      // all. The RPC surface is unauthenticated and cookie-less, so without
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
}
