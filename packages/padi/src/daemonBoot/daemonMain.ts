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
  claimPidGate,
  type DaemonExit,
  type DaemonBuildIdentity,
  type DaemonLifetimeInfo,
  daemonLifetimeFromEnv,
  daemonMain,
  type GateAcquisition,
  lifetimeInfo,
  type Logger,
  type ProcessIdentity,
} from "@kolu/surface-daemon";
import { processIdentity } from "osfacts-client";
import { osfactsBinPath } from "../ports/scan.ts";

import { buildCommit } from "@kolu/surface/identity";
import {
  implementSurfacesOnPublisher,
  publisherChannel,
} from "@kolu/surface/server";
import type { Router } from "@orpc/server";
import { configureNixShellEnv } from "kolu-pty";
import { initAutosaveGate } from "../session/autosaveGate.ts";
import { currentPadiBuildIdentity } from "./buildId.ts";
import {
  setPadiActivityFeedStore,
  setPadiLastPairedDaemonStore,
  setPadiSessionStore,
} from "../session/confStores.ts";
import { buildControlCoreDeps } from "./controlCore.ts";
import { importLegacyConfigOnce } from "../session/importLegacy.ts";
import {
  ensureKoluRoot,
  setDaemonProcessId,
  shutdownCleanup,
} from "../koluRoot.ts";
import { configureDaemonLog, log as padiLog } from "../log.ts";
import { setPadiSurfaceCtx } from "../padiSurfaceCtx.ts";
import {
  getLocalSocketPath,
  publishDaemonStatus,
  setPadiServeSocketPath,
} from "../ptyHost/daemonStatus.ts";
import {
  ensureLocalEndpoint,
  setSpawnServerVersion,
} from "../ptyHost/index.ts";
import { publisher } from "../publisher.ts";
import { buildPadiSurfaceDeps } from "../servePadi.ts";
import {
  saveSession,
  setSavedSessionFromSnapshot,
} from "../session/session.ts";
import {
  padiKavalHome,
  padiRuntimeHome,
  resolvePadiStateRoot,
  writeStateRootManifest,
} from "../stateRoot.ts";
import { resolveDaemonHome } from "@kolu/surface-daemon";
import { KAVAL_NS_PREFIX, PTY_HOST_SOCK_FILE } from "kaval";
import {
  NewerPadiStateProjectVersionError,
  openPadiStateStores,
} from "../session/stateStore.ts";
import { PADI_SURFACE_VERSION, padiDaemonSurfaces } from "../surface.ts";
import { hasParkedTerminals } from "../terminal-registry.ts";
import { startInventoryReconciler } from "../terminalEndpoint/inventoryReconcile.ts";
import {
  adoptSurvivingSession,
  parkSavedSession,
} from "../terminalEndpoint/reattach.ts";
import { resolveTerminalEndpoint } from "../terminalEndpoint/resolve.ts";
import { snapshotSession } from "../terminals.ts";
import { LOCAL_LOCATION } from "../vocab.ts";

/** Padi's immutable process boot facts, captured together exactly once. Every
 * serving projection receives this same whole value, so repeated ambient env
 * reads cannot describe different builds within one process. */
interface PadiBoot {
  readonly startedAt: number;
  readonly identity: Readonly<DaemonBuildIdentity>;
}

const PADI_BOOT: PadiBoot = Object.freeze({
  startedAt: Date.now(),
  identity: Object.freeze(currentPadiBuildIdentity()),
});

export interface PadiDaemonOptions {
  /** The state-root to anchor to — padi's identity. Resolved via
   *  {@link resolvePadiStateRoot}: explicit path or `KOLU_PADI_STATE_DIR`
   *  required (no silent default — juspay/kolu#1334). dev/e2e pass an
   *  explicit path; production wrappers set the env. */
  stateRoot?: string;
  /** Override the socket path (`--socket`); the gate sits beside it. kolu-server's
   *  binder ALWAYS sets this — the exact path it already computed with
   *  `padiSocketPath` for its own wait side — so padi's bind can never diverge from
   *  what the binder dials by independently re-reading `$XDG_RUNTIME_DIR` at spawn
   *  time (the single-source fix; see `resolvePadiLaunch`). Only a standalone padi
   *  (no binder) leaves this unset and falls back to the digest-keyed default. */
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
// Each phase takes the PRIOR phase's token, so a PHASE invoked before its predecessor
// is a COMPILE error, not a silent violation. The two ordering invariants once held by
// prose — "claim the gate FIRST" (W2.2's B1 blocker) and "the stores are injected
// before anything reads them" — are now the {@link HeldGate} / {@link StoresReady}
// types threaded through the chain; the boot below reads as `gate → stores → identity
// → serve → endpoint`, its PHASE ordering checked by the compiler. The setter sequence
// WITHIN a phase (e.g. the exit-wipe hook after `ensureKoluRoot` in
// `configureDaemonIdentity`) is a short, co-located, documented convention — not a
// compiler-checked edge; the win is that those setters are grouped into one phase
// instead of scattered across the boot the way they used to be.

/** Padi's HELD single-instance gate — the `acquired` arm of `claimPidGate`,
 *  narrowed past the `held` / `dir-not-private` exits. Threaded into every boot phase
 *  that must run UNDER the gate, so a phase reachable before the claim would not
 *  type-check (the loser of a state-root race can't clobber the winner's disk). */
type HeldGate = Extract<GateAcquisition, { kind: "acquired" }>;

/** Padi's state-root stores are OPEN, legacy-imported, and INJECTED — the precondition
 *  for anything that reads a padi cell (serve, reconcile). Carries the gate forward so
 *  the whole pipeline is value-threaded to the spine at the end. */
interface StoresReady {
  readonly phase: "stores";
  readonly gate: HeldGate;
}

/** The per-process identity (pid, serve socket, spawn version, nix-shell env,
 *  koluRoot, the exit-wipe hook, the autosave gate) is configured — the precondition
 *  for spawning a terminal or serving. */
interface IdentityReady {
  readonly phase: "identity";
  readonly gate: HeldGate;
}

/** padiSurface + the frozen control core are served and the late-bound ctx is wired
 *  (every domain writer can now publish deltas) — the precondition for booting the
 *  kaval endpoint, whose reconcile publishes onto that ctx. Carries the served
 *  router. */
interface SurfacesServed {
  readonly phase: "served";
  readonly gate: HeldGate;
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC served router — the same `Router<any, any>` the served fragment narrows to (see `serveDaemonSurfaces`).
  readonly router: Router<any, any>;
  /** Release the surface runtime's owned sources — the daemon awaits this on
   *  teardown (and on a boot-step failure) so the runtime's sources are released
   *  deterministically rather than left to process death. Idempotent; the
   *  loud-not-fatal `done` disposition is unchanged (close resolves cleanly). */
  readonly close: () => Promise<void>;
}

/** The local kaval endpoint has booted (adopt-or-spawn) and the saved session is
 *  reconciled — the precondition for the samplers + manifests that read the held
 *  kaval's socket. The served router is NOT re-carried here — this phase neither
 *  produces nor consumes it; the caller reads it straight off the `served` value. */
interface EndpointBooted {
  readonly phase: "endpoint";
  readonly gate: HeldGate;
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
  const opened = openPadiStateStores(stateRoot);
  if (opened.kind === "newer-project-version") {
    throw new NewerPadiStateProjectVersionError(opened);
  }
  const stores = opened.stores;
  // Import BEFORE the injections below — the imported values must be in place before
  // anything reads a cell. (#1658's backup, inlined per the scope note.)
  importLegacyConfigOnce(stores, log);
  setPadiSessionStore(stores.session);
  setPadiActivityFeedStore(stores.activityFeed);
  setPadiLastPairedDaemonStore(stores.lastPairedDaemon);
  return { phase: "stores", gate };
}

/** Configure padi's per-process identity + wire the autosave gate. Requires the stores
 *  token (its `koluRoot` + autosave observe the injected state), so it cannot run
 *  before injection. */
function configureDaemonIdentity(
  stores: StoresReady,
  opts: PadiDaemonOptions,
  socketPath: string,
  boot: PadiBoot,
): IdentityReady {
  // padi's OWN pid (a standalone daemon owns its disk) — koluRoot + PTY spawns need it.
  setDaemonProcessId(String(process.pid));
  // Record padi's OWN serving socket so every terminal it spawns carries it as
  // `PADI_SOCKET` (the $KAVAL_SOCKET twin) — set well before `ensureLocalEndpoint` can
  // spawn a terminal.
  setPadiServeSocketPath(socketPath);
  // `||` not `??`: the baked commit is "" off-nix and the setter refuses an
  // empty value — fall through to "dev".
  setSpawnServerVersion(
    opts.spawnVersion || boot.identity.navigableCommit || "dev",
  );
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
  return { phase: "identity", gate: stores.gate };
}

/** Serve padiSurface + the frozen control core on ONE socket and wire the late-bound
 *  ctx. Requires the identity token (spawns/serving observe it), and takes the
 *  already-built `onDrain` so a control-core drain persists + exits. */
function serveDaemonSurfaces(
  identity: IdentityReady,
  params: {
    stateRoot: string;
    onDrain: () => void;
    log: Logger;
    lifetime: DaemonLifetimeInfo;
    boot: PadiBoot;
  },
): SurfacesServed {
  const { stateRoot, onDrain, log, lifetime, boot } = params;
  const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);
  const runtime = implementSurfacesOnPublisher(
    padiDaemonSurfaces,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),
      onStreamReadError: (err, info) =>
        log.error({ err, stream: info.stream }, "padi stream read error"),
      // DECLARE padi's build identity on the `padi` sibling's reserved
      // `system.identity` — the member kolu-server's `session.identity()` reads for
      // the daemon-inventory readout (contract version · uptime · build). Same values
      // padi's control-core `hello` already echoes (the convergence axis reads THAT,
      // unchanged); this is the READOUT axis via the framework member. The commit is
      // the null-free `BuildCommit` sum (`""` off-nix → `dev`). padi always declares,
      // so its served identity is always `identified`, never `anonymous`. (S4 —
      // declared in the `SurfacesServed` phase, where the surfaces are implemented.)
      identity: {
        padi: {
          contractVersion: PADI_SURFACE_VERSION,
          buildId: boot.identity.staleKey,
          commit: buildCommit(boot.identity.navigableCommit),
        },
      },
    },
    {
      padi: buildPadiSurfaceDeps({
        endpoint: localEndpoint,
        log: padiLog,
        // The SAME `startedAt`/`commit` handed to the control-core `hello` below —
        // reused, never re-derived, so the padiSurface `identity` cell and `hello`
        // can't drift.
        startedAt: boot.startedAt,
        commit: boot.identity.navigableCommit,
        lifetime,
        // The `hostInventory` derived poll cell resolves its held-kaval fallback
        // address from this state-root.
        stateRoot,
      }),
      control: buildControlCoreDeps({
        stateRoot,
        startedAt: boot.startedAt,
        // padi's navigable git commit (`PADI_COMMIT_HASH`), echoed by `hello` so the
        // binder surfaces the RUNNING padi's build. Empty "" off-nix → honest "—".
        commit: boot.identity.navigableCommit,
        // padi's staleKey (`PADI_BUILD_ID`) — the binder's build-convergence key: a
        // same-contract build mismatch drains this padi once at binder boot (#1670).
        buildId: boot.identity.staleKey,
        onDrain,
      }),
    },
  );
  // Wire the late-bound ctx so every padi domain writer publishes deltas.
  setPadiSurfaceCtx(runtime.ctx.padi);
  // Observe the surface runtime's `done` and route it into padi's EXISTING
  // fault disposition — the loud-not-fatal unhandled-rejection boundary #1792
  // installed (log + optional health sink, never a process kill). An owned
  // surface fault becomes a diagnosable log line, not a dead workspace daemon;
  // the disposition is unchanged (a fault does not exit), only its route (owned
  // `done` instead of a floated rejection reaching the process boundary).
  runtime.done.catch((err) =>
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "padi surface runtime faulted",
    ),
  );
  // `implementSurfacesOnPublisher` returns the FINAL top-level router — the
  // socket's handler routes it directly (no re-wrap; the double-prefix is gone
  // at the framework seam).
  // biome-ignore lint/suspicious/noExplicitAny: SurfaceRuntime.router is opaque; the runtime shape is a valid top-level served router — the same cast every serving site uses.
  const servedRouter = runtime.router as Router<any, any>;
  return {
    phase: "served",
    gate: identity.gate,
    router: servedRouter,
    close: runtime.close,
  };
}

/** Boot padi's OWN kaval (adopt-or-spawn under `kaval-<digest>/`), reconcile its live
 *  PTYs against the saved session, and start the live inventory reconciler. Requires
 *  the served surfaces — the reconcile publishes onto the wired ctx. */
async function bootLocalEndpoint(
  served: SurfacesServed,
  params: {
    kavalHome: import("@kolu/surface-daemon").DaemonHomePaths;
    legacyKavalHome?: import("@kolu/surface-daemon").DaemonHomePaths;
  },
): Promise<EndpointBooted> {
  await ensureLocalEndpoint({
    home: params.kavalHome,
    // The W2.2 upgrade bridge: adopt a surviving pre-W2.2 port-keyed kaval (if the
    // binder hinted its port home and this padi has no digest kaval yet) rather than
    // leaking it. Standalone padi (no binder) passes nothing → no legacy adopt.
    legacyHome: params.legacyKavalHome,
    onStatus: publishDaemonStatus,
    onAdopted: adoptSurvivingSession,
    onNotAdopted: parkSavedSession,
    onBootSettled: startInventoryReconciler,
  });
  return { phase: "endpoint", gate: served.gate };
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
  // Resolve identity FIRST — bind refuses without an explicit path (#1334). Logger
  // open and every path derivation need the resolved root; configureDaemonLog used
  // to re-resolve ambiently and would throw (or, pre-#1334, log under production).
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  // A DAEMON boot: route padi's domain pino stream (the `@kolu/padi` `log` this module and its
  // domain code share) to the rolled-file + stderr multistream (P0). Unconditional at the ONE
  // entrypoint every spawn path runs, so no spawn path can forget it; fails loud here if the
  // state root is unwritable. The `--stdio` front never reaches this, so it keeps stdout.
  configureDaemonLog(stateRoot);
  // Home construction absorbs socketOverride — gate co-located by construction.
  const home = padiRuntimeHome(stateRoot, opts.socketOverride);
  const kavalHome = padiKavalHome(stateRoot);
  const legacyKavalHome =
    opts.legacyKavalSocket !== undefined && opts.legacyKavalSocket !== ""
      ? resolveDaemonHome({
          app: KAVAL_NS_PREFIX,
          placement: "runtime",
          socketFile: PTY_HOST_SOCK_FILE,
          socketOverride: opts.legacyKavalSocket,
        })
      : undefined;

  // ── Claim the single-instance gate FIRST, before ANY boot side effect ──
  // A second padi racing this same state-root must learn it lost the race BEFORE it
  // runs the legacy import, recycles the shared kaval (`ensureLocalEndpoint`), or
  // writes the state manifests — else the loser clobbers the winner's disk. So the
  // gate is acquired here, at the top, and HANDED to the spine's `daemonMain` (which
  // otherwise acquires it last, after all of that). A crash mid-boot (the fail-fast
  // import) leaves a gate held by a dead pid, which the next launch reclaims.
  const readProcessIdentity = (pid: number): ProcessIdentity | undefined =>
    processIdentity(osfactsBinPath(), pid);
  const selfIdentity = readProcessIdentity(process.pid);
  if (selfIdentity === undefined) {
    throw new Error(
      `osfacts could not resolve this padi process (${process.pid})`,
    );
  }
  const claimed = await claimPidGate(
    home.gatePath,
    home.socketPath,
    selfIdentity,
    readProcessIdentity,
  );
  if (claimed.kind === "held") {
    log.info(
      { gatePath: home.gatePath, pid: claimed.pid },
      "padi already running for this state-root; yielding to the live instance",
    );
    return { kind: "already-running", pid: claimed.pid };
  }
  if (claimed.kind === "dir-not-private") {
    log.error(
      { gatePath: home.gatePath, dir: claimed.dir },
      "padi gate directory is not private (owner-only); refusing to start",
    );
    return { kind: "serve-failed", detail: "dir-not-private" };
  }
  const gate = claimed;

  // Gate → stores → identity: each phase takes the prior's token, so none can run
  // before the gate is claimed above (a lost gate-race returns before reaching here).
  const stores = openStateStores(gate, stateRoot, log);
  const identity = configureDaemonIdentity(
    stores,
    opts,
    home.socketPath,
    PADI_BOOT,
  );

  // Resolve the lifetime ONCE: `forever` in production; `boundToPid` when a
  // harness/smoke run set `KOLU_DAEMON_BIND_PID`. Seeded into the padiSurface
  // `identity` cell (via `serveDaemonSurfaces` → `buildPadiSurfaceDeps`) AND handed
  // to `daemonMain` below — the same value, reused so the readout and the actual
  // policy can't drift.
  const lifetime = daemonLifetimeFromEnv({ kind: "forever" });

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
  const served = serveDaemonSurfaces(identity, {
    stateRoot,
    onDrain,
    log,
    lifetime: lifetimeInfo(lifetime),
    boot: PADI_BOOT,
  });
  try {
    const endpoint = await bootLocalEndpoint(served, {
      kavalHome,
      legacyKavalHome,
    });

    // Manifests run AFTER the endpoint boot (the `endpoint` token proves it): they
    // read the held kaval's socket / a connected daemon.
    // (padi's `processMemory` rail is now a DERIVED poll cell owned by the served
    // surface — `servePadi.ts` — so it no longer needs a boot-time sampler start.)
    // Manifests (digest → state-root) so a flag-less kaval-tui can label what it
    // discovers — written into both padi's and its kaval's runtime dirs.
    writeStateRootManifest(home.dir, stateRoot);
    // Beside the kaval this padi ACTUALLY holds — `getLocalSocketPath()` is the digest
    // socket normally, but the adopted LEGACY port socket after an upgrade adoption, so
    // discovery labels the real daemon and no empty digest dir is minted.
    writeStateRootManifest(
      dirname(getLocalSocketPath() ?? kavalHome.socketPath),
      stateRoot,
    );
    // (The Kaval + Padi dialogs' "Running daemons" list — `hostInventory` — is now a
    // DERIVED poll cell owned by the served surface (`servePadi.ts`); its poll read
    // resolves the discovered kaval from the state-root, so no boot-time sampler start
    // is needed. The serving padi still reports ITSELF by construction — see
    // `withSelfPadi` — reading padi's serve socket from the module global.)

    return await daemonMain({
      // Full home — gate+socket from one resolve; override absorbed at construction.
      home,
      processIdentity: selfIdentity,
      readProcessIdentity,
      // The router is the serve phase's output — read it straight off `served` rather
      // than re-threading it through the endpoint token that neither owns nor touches it.
      router: served.router,
      // The same lifetime resolved above (reused, never re-derived) — so the value
      // seeded into the padiSurface `identity` cell is provably the one governing the
      // daemon. `forever` in production; `boundToPid` under a harness/smoke run (padi
      // forwards the same var into its kaval).
      lifetime,
      // padi's ANCHOR is its state-root — the identity it resolved as its very
      // first act (#1334), known directly, no manifest indirection (unlike its
      // kaval, which must read the root back off the manifest padi writes).
      // When the root is deleted — `git worktree remove` on a dev workspace —
      // padi reaps itself instead of leaking forever (juspay/kolu#2010: the
      // very leak class its kaval already self-collected since #1713). No
      // session persist on the way out: the place a session would persist TO
      // is exactly what is gone.
      // Override the default (`home.dir` = runtime rendezvous); state-root is
      // the durable identity, not the ephemeral runtime home.
      anchor: () => stateRoot,
      log,
      signal: drainController.signal,
      onReady: opts.onReady,
      // The gate claimed at the top, threaded through the pipeline — the spine serves
      // under it and releases it on teardown, rather than acquiring it here (too late).
      gate: endpoint.gate,
    });
  } finally {
    // Own the surface runtime's shutdown: once the daemon has stopped serving (or a
    // boot step above threw), release its owned sources. Awaited here so the release
    // is deterministic rather than left to process death; disposition unchanged
    // (loud-not-fatal — close resolves cleanly and never faults `done`).
    await served.close();
  }
}
