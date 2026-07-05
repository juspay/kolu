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
import { initSessionAutoSave, setSavedSessionFromSnapshot } from "./session.ts";
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

/** Run the padi daemon to completion: own its state-root, adopt-or-spawn its
 *  kaval, reconcile the saved session, serve `padiSurface` + the control core over
 *  padi's digest-keyed socket, and stay up until drained / signalled. Resolves the
 *  spine's {@link DaemonExit} for the bin to map to an exit code. */
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

  // ── padi's own state-root store (the W2.2 move off kolu-server's conf) ──
  // The three cells padi owns — session, activityFeed, lastPairedDaemon — now
  // read/write padi's OWN `Conf` under the state-root. Injected BEFORE anything
  // serves or reconciles (a read before this crashes loudly), exactly as
  // kolu-server injected its conf stores in-process before the cutover.
  const stores = openPadiStateStores(stateRoot);
  // The one-shot import: on the first boot with a legacy `$KOLU_STATE_DIR` set
  // (kolu-server forwards it), carry session/activityFeed/lastPairedDaemon across
  // from the old shared config, ONCE — taking a backup first, crashing loudly on a
  // bad file. Runs BEFORE the stores are injected so the imported values are in
  // place before anything reads them. (#1658's backup, inlined per the scope note.)
  importLegacyConfigOnce(stores, log);
  setPadiSessionStore(stores.session);
  setPadiActivityFeedStore(stores.activityFeed);
  setPadiLastPairedDaemonStore(stores.lastPairedDaemon);

  // The per-process identity padi's koluRoot + PTY spawns need — padi's OWN pid
  // (a standalone daemon owns its disk) and the version stamped on spawned PTYs.
  setDaemonProcessId(String(process.pid));
  // Record padi's OWN serving socket so every terminal it spawns carries it as
  // `PADI_SOCKET` (the $KAVAL_SOCKET twin) — a `padi-tui` inside a kolu terminal
  // then reaches the padi that owns it flag-free. Set before anything can spawn a
  // terminal (well before `ensureLocalEndpoint`).
  setPadiServeSocketPath(socketPath);
  // `||` not `??`: currentPadiCommitHash() is "" off-nix (no baked env), and the
  // spawn-version setter refuses an empty value — fall through to "dev".
  setSpawnServerVersion(opts.spawnVersion || currentPadiCommitHash() || "dev");
  configureNixShellEnv(opts.nixShellWhitelist);
  ensureKoluRoot();
  // padi OWNS its per-process scratch root now (the W2.2 move off kolu-server):
  // the shell rc files, per-terminal scratch, and upload/init files live under
  // `${runtimeRoot}/kolu-<padi-pid>`. Register the wipe on `exit` — the same hook
  // kolu-server used before the cutover — so a normal padi drain/restart (which
  // ends the process) removes the root instead of leaking it. Registered only
  // AFTER `ensureKoluRoot` created the dir (a lost gate-race returns above, never
  // reaching here), and after `setDaemonProcessId` so `koluRoot()` resolves. A
  // hard kill / power loss bypasses `exit` (the XDG logout-wipe is the backstop),
  // exactly as before.
  process.on("exit", shutdownCleanup);
  initSessionAutoSave(snapshotSession);

  // ── The drain trigger ── control-core `drain` persists + exits; the caller
  // observes the socket close. Fold it into an abort of the daemon lifetime,
  // composed with any external stop signal.
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

  // ── Serve padiSurface + the frozen control core on ONE socket ──
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
        // Empty "" off-nix (the binder never build-drains a "" survivor of a "" binder).
        buildId: currentPadiBuildId(),
        onDrain,
      }),
    },
  );
  // Wire the late-bound ctx so every padi domain writer publishes deltas.
  setPadiSurfaceCtx(ctx.padi);
  // Wrap the `implementSurfaces` FRAGMENT in a top-level contract router so the
  // socket's StandardRPCHandler can route it — the bare fragment answers "Not
  // Found" over the wire (the same wrap kaval's `createInProcessPtyHost` does).
  const servedRouter = implement(padiDaemonContract).router(
    // biome-ignore lint/suspicious/noExplicitAny: the fragment's procedure-context type doesn't line up with implement().router()'s contract-derived param, though the runtime shape is exactly what serving wants (mirrors kaval's inProcessPtyHost wrap).
    surfaceFragment as any,
    // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC served router — the same `Router<any, any>` cast kaval's inProcessPtyHost narrows to (the contract-derived context doesn't line up, runtime shape is correct).
  ) as Router<any, any>;

  // ── Boot orchestration — padi adopts-or-spawns its OWN kaval under
  // `kaval-<digest>/`, reconciles its live PTYs against the saved session, and
  // starts the live inventory reconciler. (The SAME orchestration kolu-server ran
  // in-process until W2.2; it now runs in padi's process, keyed by state-root.)
  await ensureLocalEndpoint({
    kavalSocket,
    // The W2.2 upgrade bridge: adopt a surviving pre-W2.2 port-keyed kaval (if the
    // binder hinted its port socket and this padi has no digest kaval yet) rather
    // than leaking it. Standalone padi (no binder) passes nothing → no legacy adopt.
    legacyKavalSocket: opts.legacyKavalSocket,
    onStatus: publishDaemonStatus,
    onAdopted: adoptSurvivingSession,
    onNotAdopted: parkSavedSession,
    onBootSettled: startInventoryReconciler,
  });

  // Feed the chrome bar's memory rail: sample padi's OWN RSS + poll its kaval's on
  // a fixed cadence and publish the pair on `padiSurface.processMemory` (kolu-server
  // folds it into the rail's cell). Started after `ensureLocalEndpoint` so the first
  // kaval poll can reach a connected daemon; a not-yet-connected kaval reads `absent`.
  startPadiMemorySampler();

  // ── Manifests (digest → state-root) so a flag-less kaval-tui can label what it
  // discovers. padi knows the state-root the opaque digest stands for; write it
  // into both padi's and its kaval's runtime dirs.
  writeStateRootManifest(dirname(socketPath), stateRoot);
  // Beside the kaval this padi ACTUALLY holds — `getLocalSocketPath()` is the digest
  // socket normally, but the adopted LEGACY port socket after an upgrade adoption. So
  // discovery labels the real daemon "kolu @ <state-root>" (not the bare "port N"),
  // and no empty digest dir is minted when the port kaval was adopted instead.
  writeStateRootManifest(
    dirname(getLocalSocketPath() ?? kavalSocket),
    stateRoot,
  );

  // Feed the Kaval + Padi dialogs' "Running daemons" list: scan THIS host's running
  // kaval + padi daemons (read-only) and publish them on `padiSurface.hostInventory`,
  // marking the kaval this padi holds + itself `active`. Because it rides the re-served
  // surface, the dialog shows the BOUND host's daemons identically whether kolu-server
  // reaches this padi locally or over ssh — so a leaked daemon on the machine you're
  // actually using is finally visible. Started after `ensureLocalEndpoint` so the held
  // kaval's socket is known, and after the manifests are written so the very first tick
  // labels the discovered kaval by state-root. The serving padi reports ITSELF by
  // construction (see `withSelfPadi`), so the liveness tell holds even on this T+0 tick,
  // before `daemonMain` below opens `padi.sock`.
  startPadiHostInventorySampler({ padiSocket: socketPath, stateRoot });

  return daemonMain({
    gatePath,
    socketPath,
    router: servedRouter,
    lifetime: { kind: "forever" },
    log,
    signal: drainController.signal,
    onReady: opts.onReady,
    // The gate we already claimed at the top — the spine serves under it and
    // releases it on teardown, rather than acquiring it here (too late).
    gate,
  });
}
