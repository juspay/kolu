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
import { currentPadiCommitHash } from "./buildId.ts";
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
import { log as padiLog } from "./log.ts";
import { startPadiMemorySampler } from "./memorySampler.ts";
import { setPadiSurfaceCtx } from "./padiSurfaceCtx.ts";
import { publisher } from "./publisher.ts";
import { publishDaemonStatus } from "./ptyHost/daemonStatus.ts";
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
    setSavedSessionFromSnapshot(snapshotSession());
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
  writeStateRootManifest(dirname(kavalSocket), stateRoot);

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
