/**
 * padi's daemon composition — the "soul" side of `@kolu/surface-daemon`'s spine
 * (the twin of `kaval/src/daemonMain.ts`). It supplies padi's choices — where its
 * gate/socket/state-root live, the served router (`padiSurface` + the frozen
 * control core), the boot orchestration that adopts-or-spawns padi's OWN kaval and
 * reconciles the saved session, the `forever` lifetime — and nothing more. The
 * mechanism (gate → serve → teardown) lives in the spine.
 *
 * padi computes its OWN paths in-package (`./stateRoot.ts`): it does NOT import
 * kolu-server's runtime-path helpers. A standalone daemon owns its disk. This is
 * the SAME padi-domain boot kolu-server ran in-process until W2.2
 * (`packages/server/src/index.ts`) — it just moved into padi's own process, now
 * anchored to padi's persistent state-root instead of injected conf stores.
 */

import { dirname } from "node:path";
import {
  acquirePidGate,
  type DaemonExit,
  daemonMain,
  type GateAcquisition,
  type Logger,
} from "@kolu/surface-daemon";

/** padi's boot time (ms epoch), stamped ONCE when this module first loads — i.e.
 *  at process start. The control-core `hello` echoes it so the binder measures
 *  honest uptime instead of resetting the age on every reconnect. */
const PADI_STARTED_AT = Date.now();
import { implementSurfaces, publisherChannel } from "@kolu/surface/server";
import { implement, type Router } from "@orpc/server";
import { configureNixShellEnv } from "kolu-pty";
import { currentPadiBuildId, currentPadiCommitHash } from "./buildId.ts";
import {
  setPadiActivityFeedStore,
  setPadiLastPairedDaemonStore,
  setPadiSessionStore,
} from "./confStores.ts";
import { buildControlCoreDeps } from "./controlCore.ts";
import { importLegacyConfigOnce } from "./importLegacy.ts";
import {
  ensureKoluRoot,
  setDaemonProcessId,
  shutdownCleanup,
} from "./koluRoot.ts";
import { configureDaemonLog, log as padiLog } from "./log.ts";
import { startPadiHostInventorySampler } from "./hostInventory.ts";
import { startPadiMemorySampler } from "./memorySampler.ts";
import { setPadiSurfaceCtx } from "./padiSurfaceCtx.ts";
import { publisher } from "./publisher.ts";
import {
  getLocalSocketPath,
  publishDaemonStatus,
  setPadiServeSocketPath,
} from "./ptyHost/daemonStatus.ts";
import { ensureLocalEndpoint, setSpawnServerVersion } from "./ptyHost/index.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import { initAutosaveGate } from "./autosaveGate.ts";
import { saveSession, setSavedSessionFromSnapshot } from "./session.ts";
import { hasParkedTerminals } from "./terminal-registry.ts";
import {
  padiGatePath,
  padiKavalSocketPath,
  padiSocketPath,
  resolvePadiStateRoot,
  writeStateRootManifest,
} from "./stateRoot.ts";
import { openPadiStateStores } from "./stateStore.ts";
import { padiDaemonContract, padiDaemonSurfaces } from "./surface.ts";
import { startInventoryReconciler } from "./terminalEndpoint/inventoryReconcile.ts";
import {
  adoptSurvivingSession,
  parkSavedSession,
} from "./terminalEndpoint/reattach.ts";
import { resolveTerminalEndpoint } from "./terminalEndpoint/resolve.ts";
import { snapshotSession } from "./terminals.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

export interface PadiDaemonOptions {
  /** The state-root to anchor to — padi's identity. Defaults (via
   *  {@link resolvePadiStateRoot}) to `KOLU_PADI_STATE_DIR` else the binary's
   *  spelled default. dev/e2e pass an explicit path. */
  stateRoot?: string;
  /** Override the socket path (`--socket`); the gate sits beside it. Rarely set
   *  — the digest-keyed default is the whole point of the rendezvous. */
  socketOverride?: string;
  /** The env whitelist for `--allow-nix-shell-with-env-whitelist`, forwarded so
   *  PTY spawns compose the same nix-devshell env kolu-server did. */
  nixShellWhitelist?: string;
  /** The version stamped as spawned PTYs' `TERM_PROGRAM_VERSION`. Defaults to
   *  padi's own commit; kolu-server forwards the app version for byte-identity. */
  spawnVersion?: string;
  /** The LEGACY per-port kaval socket the BINDER hints (its OWN listen port's
   *  `kaval-<port>/pty-host.sock`, `--legacy-kaval-socket`) — the W2.2 upgrade bridge.
   *  On the first W2.2 boot, if the digest kaval gate is empty but a compatible
   *  pre-W2.2 kaval is alive here, this padi ADOPTS it (its PTYs survive the upgrade)
   *  instead of leaking it. Absent for a STANDALONE padi (no binder → no legacy
   *  adoption, so a dev instance's port kaval is never touched). */
  legacyKavalSocket?: string;
  log: Logger;
  /** External stop signal (tests / a parent teardown). Composed with the
   *  drain-triggered abort. */
  signal?: AbortSignal;
  /** Readiness hook — fired once the socket is listening. */
  onReady?: (info: { socketPath: string; pid: number }) => void;
}

// ── Typed boot pipeline ───────────────────────────────────────────────────────
// Each phase takes the PRIOR phase's token, so a step invoked before its precondition
// is a COMPILE error, not a silent violation. The two ordering invariants once held by
// prose — "claim the gate FIRST" (W2.2's B1 blocker) and "the stores are injected
// before anything reads them" — are now the {@link HeldGate} / {@link StoresReady}
// types threaded through the chain; the boot below reads as `gate → stores → identity
// → serve → endpoint` with the dependency edges checked by the compiler.

/** Padi's HELD single-instance gate — the `acquired` arm of `acquirePidGate`,
 *  narrowed past the `held` / `dir-not-private` exits. Threaded into every boot phase
 *  that must run UNDER the gate, so a phase reachable before the claim would not
 *  type-check (the loser of a state-root race can't clobber the winner's disk). */
type HeldGate = Extract<GateAcquisition, { kind: "acquired" }>;

/** Padi's state-root stores are OPEN, legacy-imported, and INJECTED — the precondition
 *  for anything that reads a padi cell (serve, reconcile). Carries the gate forward so
 *  the whole pipeline is value-threaded to the spine at the end. */
interface StoresReady {
  readonly gate: HeldGate;
}

/** The per-process identity (pid, serve socket, spawn version, nix-shell env,
 *  koluRoot, the exit-wipe hook, the autosave gate) is configured — the precondition
 *  for spawning a terminal or serving. */
interface IdentityReady {
  readonly gate: HeldGate;
}

/** padiSurface + the frozen control core are served and the late-bound ctx is wired
 *  (every domain writer can now publish deltas) — the precondition for booting the
 *  kaval endpoint, whose reconcile publishes onto that ctx. Carries the served
 *  router. */
interface SurfacesServed {
  readonly gate: HeldGate;
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC served router — the same `Router<any, any>` the served fragment narrows to (see `serveDaemonSurfaces`).
  readonly router: Router<any, any>;
}

/** The local kaval endpoint has booted (adopt-or-spawn) and the saved session is
 *  reconciled — the precondition for the samplers + manifests that read the held
 *  kaval's socket. */
interface EndpointBooted {
  readonly gate: HeldGate;
  // biome-ignore lint/suspicious/noExplicitAny: threads the served router (see `SurfacesServed`).
  readonly router: Router<any, any>;
}

/** Open padi's state-root stores UNDER the held gate: open the `Conf`, run the
 *  one-shot legacy import BEFORE injecting (so imported values are in place before any
 *  reader), then inject the three cells' backing stores. The `gate: HeldGate` param is
 *  the compile-time proof the gate was claimed first — a padi that lost the race exits
 *  before this is reachable. */
function openStateStores(
  gate: HeldGate,
  stateRoot: string,
  log: Logger,
): StoresReady {
  const stores = openPadiStateStores(stateRoot);
  // Import BEFORE the injections below — the imported values must be in place before
  // anything reads a cell. (#1658's backup, inlined per the scope note.)
  importLegacyConfigOnce(stores, log);
  setPadiSessionStore(stores.session);
  setPadiActivityFeedStore(stores.activityFeed);
  setPadiLastPairedDaemonStore(stores.lastPairedDaemon);
  return { gate };
}

/** Configure padi's per-process identity + wire the autosave gate. Requires the stores
 *  token (its `koluRoot` + autosave observe the injected state), so it cannot run
 *  before injection. */
function configureDaemonIdentity(
  stores: StoresReady,
  opts: PadiDaemonOptions,
  socketPath: string,
): IdentityReady {
  // padi's OWN pid (a standalone daemon owns its disk) — koluRoot + PTY spawns need it.
  setDaemonProcessId(String(process.pid));
  // Record padi's OWN serving socket so every terminal it spawns carries it as
  // `PADI_SOCKET` (the $KAVAL_SOCKET twin) — set well before `ensureLocalEndpoint` can
  // spawn a terminal.
  setPadiServeSocketPath(socketPath);
  // `||` not `??`: `currentPadiCommitHash()` is "" off-nix and the setter refuses an
  // empty value — fall through to "dev".
  setSpawnServerVersion(opts.spawnVersion || currentPadiCommitHash() || "dev");
  configureNixShellEnv(opts.nixShellWhitelist);
  ensureKoluRoot();
  // Register the scratch-root wipe on `exit` — only AFTER `ensureKoluRoot` created the
  // dir and `setDaemonProcessId` so `koluRoot()` resolves. A hard kill bypasses `exit`
  // (the XDG logout-wipe is the backstop).
  process.on("exit", shutdownCleanup);
  // Wire the AutosaveGate to the live terminal set + the restore-pending query (read
  // LIVE at fire — the registry is its source of truth) + the persist effect. The gate
  // owns WHEN to save; the writers only pulse `notifyDirty`.
  initAutosaveGate({
    snapshot: snapshotSession,
    isRestorePending: hasParkedTerminals,
    persist: saveSession,
  });
  return { gate: stores.gate };
}

/** Serve padiSurface + the frozen control core on ONE socket and wire the late-bound
 *  ctx. Requires the identity token (spawns/serving observe it), and takes the
 *  already-built `onDrain` so a control-core drain persists + exits. */
function serveDaemonSurfaces(
  identity: IdentityReady,
  params: { stateRoot: string; onDrain: () => void; log: Logger },
): SurfacesServed {
  const { stateRoot, onDrain, log } = params;
  const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);
  const { router: surfaceFragment, ctx } = implementSurfaces(
    padiDaemonSurfaces,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),
      onStreamReadError: (err, info) =>
        log.error({ err, stream: info.stream }, "padi stream read error"),
    },
    {
      padi: buildPadiSurfaceDeps({ endpoint: localEndpoint, log: padiLog }),
      control: buildControlCoreDeps({
        stateRoot,
        startedAt: PADI_STARTED_AT,
        // padi's navigable git commit (`PADI_COMMIT_HASH`), echoed by `hello` so the
        // binder surfaces the RUNNING padi's build. Empty "" off-nix → honest "—".
        commit: currentPadiCommitHash(),
        // padi's staleKey (`PADI_BUILD_ID`) — the binder's build-convergence key: a
        // same-contract build mismatch drains this padi once at binder boot (#1670).
        buildId: currentPadiBuildId(),
        onDrain,
      }),
    },
  );
  // Wire the late-bound ctx so every padi domain writer publishes deltas.
  setPadiSurfaceCtx(ctx.padi);
  // Wrap the fragment in a top-level contract router so the socket's handler can route
  // it (the bare fragment answers "Not Found"; the same wrap kaval's inProcessPtyHost
  // does).
  const servedRouter = implement(padiDaemonContract).router(
    // biome-ignore lint/suspicious/noExplicitAny: the fragment's procedure-context type doesn't line up with implement().router()'s contract-derived param, though the runtime shape is exactly what serving wants (mirrors kaval's inProcessPtyHost wrap).
    surfaceFragment as any,
    // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC served router — the same `Router<any, any>` cast kaval's inProcessPtyHost narrows to (the contract-derived context doesn't line up, runtime shape is correct).
  ) as Router<any, any>;
  return { gate: identity.gate, router: servedRouter };
}

/** Boot padi's OWN kaval (adopt-or-spawn under `kaval-<digest>/`), reconcile its live
 *  PTYs against the saved session, and start the live inventory reconciler. Requires
 *  the served surfaces — the reconcile publishes onto the wired ctx. */
async function bootLocalEndpoint(
  served: SurfacesServed,
  params: { kavalSocket: string; legacyKavalSocket?: string },
): Promise<EndpointBooted> {
  await ensureLocalEndpoint({
    kavalSocket: params.kavalSocket,
    // The W2.2 upgrade bridge: adopt a surviving pre-W2.2 port-keyed kaval (if the
    // binder hinted its port socket and this padi has no digest kaval yet) rather than
    // leaking it. Standalone padi (no binder) passes nothing → no legacy adopt.
    legacyKavalSocket: params.legacyKavalSocket,
    onStatus: publishDaemonStatus,
    onAdopted: adoptSurvivingSession,
    onNotAdopted: parkSavedSession,
    onBootSettled: startInventoryReconciler,
  });
  return { gate: served.gate, router: served.router };
}

/** Run the padi daemon to completion: own its state-root, adopt-or-spawn its
 *  kaval, reconcile the saved session, serve `padiSurface` + the control core over
 *  padi's digest-keyed socket, and stay up until drained / signalled. Resolves the
 *  spine's {@link DaemonExit} for the bin to map to an exit code. The boot is a typed
 *  pipeline (see the phase functions above); this reads as its call graph. */
export async function runPadiDaemon(
  opts: PadiDaemonOptions,
): Promise<DaemonExit> {
  const { log } = opts;
  // A DAEMON boot: route padi's domain pino stream (the `@kolu/padi` `log` this module and its
  // domain code share) to the rolled-file + stderr multistream (P0). Unconditional at the ONE
  // entrypoint every spawn path runs, so no spawn path can forget it; fails loud here if the
  // state root is unwritable. The `--stdio` front never reaches this, so it keeps stdout.
  configureDaemonLog();
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  const socketPath = padiSocketPath(stateRoot, opts.socketOverride);
  const gatePath = padiGatePath(socketPath);
  const kavalSocket = padiKavalSocketPath(stateRoot);

  // ── Claim the single-instance gate FIRST, before ANY boot side effect ──
  // A second padi racing this same state-root must learn it lost the race BEFORE it
  // runs the legacy import, recycles the shared kaval (`ensureLocalEndpoint`), or
  // writes the state manifests — else the loser clobbers the winner's disk. So the
  // gate is acquired here, at the top, and HANDED to the spine's `daemonMain` (which
  // otherwise acquires it last, after all of that). A crash mid-boot (the fail-fast
  // import) leaves a gate held by a dead pid, which the next launch reclaims.
  const gate = acquirePidGate(gatePath);
  if (gate.kind === "held") {
    log.info(
      { gatePath, pid: gate.pid },
      "padi already running for this state-root; yielding to the live instance",
    );
    return { kind: "already-running", pid: gate.pid };
  }
  if (gate.kind === "dir-not-private") {
    log.error(
      { gatePath, dir: gate.dir },
      "padi gate directory is not private (owner-only); refusing to start",
    );
    return { kind: "serve-failed", detail: "dir-not-private" };
  }

  // Gate → stores → identity: each phase takes the prior's token, so none can run
  // before the gate is claimed above (a lost gate-race returns before reaching here).
  const stores = openStateStores(gate, stateRoot, log);
  const identity = configureDaemonIdentity(stores, opts, socketPath);

  // ── The drain trigger ── control-core `drain` persists + exits; the caller observes
  // the socket close. Built HERE (not in a phase) so `onDrain` closes over
  // `drainController` — which the spine's `daemonMain` also aborts on — and can be
  // handed to the serve phase; composed with any external stop signal.
  const drainController = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) drainController.abort();
    else
      opts.signal.addEventListener("abort", () => drainController.abort(), {
        once: true,
      });
  }
  const onDrain = (): void => {
    // Persist the live layout so a re-spawn restores it; the PTYs stay alive in
    // kaval. `setSavedSessionFromSnapshot` is the EMPTY-PRESERVE receptacle: a drain
    // while the registry is empty or parked-only must NOT null a non-empty saved blob
    // (the W1 zest-loss class) — an empty snapshot leaves the existing session intact,
    // and the write cancels any pending autosave that could re-null it afterward.
    const snap = snapshotSession();
    // A control-core drain is why padi is about to exit — logged HERE (the spine only
    // logs the generic "daemon shutting down {reason: abort}", which can't be told from
    // a plain signal). This is the newer-binder convergence / "restart" endpoint; the
    // kaval + PTYs survive it, so name that so an operator reads a graceful handover,
    // not a crash.
    log.info(
      { terminals: snap.terminals.length },
      "control-core drain received — persisting session and exiting; kaval + PTYs survive",
    );
    setSavedSessionFromSnapshot(snap);
    drainController.abort();
  };

  // Serve → boot the endpoint: the reconcile publishes onto the ctx the serve phase
  // wires, so `bootLocalEndpoint` takes the served token.
  const served = serveDaemonSurfaces(identity, { stateRoot, onDrain, log });
  const endpoint = await bootLocalEndpoint(served, {
    kavalSocket,
    legacyKavalSocket: opts.legacyKavalSocket,
  });

  // Samplers + manifests run AFTER the endpoint boot (the `endpoint` token proves it):
  // they read the held kaval's socket / a connected daemon.
  // Feed the chrome bar's memory rail: sample padi's OWN RSS + poll its kaval's on a
  // fixed cadence; a not-yet-connected kaval reads `absent`.
  startPadiMemorySampler();
  // Manifests (digest → state-root) so a flag-less kaval-tui can label what it
  // discovers — written into both padi's and its kaval's runtime dirs.
  writeStateRootManifest(dirname(socketPath), stateRoot);
  // Beside the kaval this padi ACTUALLY holds — `getLocalSocketPath()` is the digest
  // socket normally, but the adopted LEGACY port socket after an upgrade adoption, so
  // discovery labels the real daemon and no empty digest dir is minted.
  writeStateRootManifest(
    dirname(getLocalSocketPath() ?? kavalSocket),
    stateRoot,
  );
  // Feed the Kaval + Padi dialogs' "Running daemons" list — started after the
  // manifests so the very first tick labels the discovered kaval by state-root. The
  // serving padi reports ITSELF by construction (see `withSelfPadi`).
  startPadiHostInventorySampler({ padiSocket: socketPath, stateRoot });

  return daemonMain({
    gatePath,
    socketPath,
    router: endpoint.router,
    lifetime: { kind: "forever" },
    log,
    signal: drainController.signal,
    onReady: opts.onReady,
    // The gate claimed at the top, threaded through the pipeline — the spine serves
    // under it and releases it on teardown, rather than acquiring it here (too late).
    gate: endpoint.gate,
  });
}
