import { dirname } from "node:path";
import {
  PADI_GATE_FILE,
  padiRuntimeHome,
  resolvePadiStateRoot,
} from "@kolu/padi-client/rendezvous";
import {
  encodeHostLocation,
  LOCAL_LOCATION,
  PADI_SURFACE_VERSION,
  padiDaemonGroup,
  padiDaemonSurfaces,
} from "@kolu/padi-client/surface";
import { buildCommit } from "@kolu/surface/identity";
import {
  implementSurfacesOnPublisher,
  publisherChannel,
  type SurfaceHandlers,
} from "@kolu/surface/server";
import {
  armRuntimeFaultExit,
  claimPidGate,
  daemonSweepRegimes,
  type DaemonBuildIdentity,
  type DaemonExit,
  type DaemonLifetimeInfo,
  daemonLifetimeFromEnv,
  daemonMain,
  type GateAcquisition,
  type Logger,
  lifetimeInfo,
  type ProcessIdentity,
  reapStaleDaemonHomes,
  resolveDaemonHome,
} from "@kolu/surface-daemon";
import { Context, Effect, Layer } from "effect";
import type { Rpc, RpcGroup } from "effect/rpc";
import { KAVAL_GATE_FILE, KAVAL_NS_PREFIX, PTY_HOST_SOCK_FILE } from "kaval";
import { configureNixShellEnv } from "kolu-pty";
import { processIdentityFromEnv } from "osfacts-client";
import {
  setAgentToolsLinkDirs,
  writeAgentToolsBakeRecord,
  writeAgentToolsLinks,
} from "../agentToolsBake.ts";
import { observeHeldKaval } from "../kavalObservation.ts";
import { startKavalSupervision } from "../kavalSupervision.ts";
import {
  ensureKoluRoot,
  setDaemonProcessId,
  shutdownCleanup,
} from "../koluRoot.ts";
import { configureDaemonLog, log as padiLog } from "../log.ts";
import { serveOduSibling } from "../odu.ts";
import { setPadiSurfaceCtx } from "../padiSurfaceCtx.ts";
import {
  getLocalSocketPath,
  publishDaemonStatus,
  setAutoRecovered,
  setLinkRestored,
  setPadiServeSocketPath,
} from "../ptyHost/daemonStatus.ts";
import {
  ensureLocalEndpoint,
  setSpawnServerVersion,
} from "../ptyHost/index.ts";
import { publisher } from "../publisher.ts";
import { buildPadiSurfaceDeps } from "../servePadi.ts";
import { startPadiDiagnostics } from "../diagnostics/index.ts";
import { installChildMeter } from "kolu-io";
import {
  captureFinalSession,
  initAutosaveGate,
} from "../session/autosaveGate.ts";
import {
  setPadiActivityFeedStore,
  setPadiLastPairedDaemonStore,
  setPadiSessionStore,
} from "../session/confStores.ts";
import { importLegacyConfigOnce } from "../session/importLegacy.ts";
import {
  orphanedParkedIds,
  saveActiveTerminalId,
  saveSession,
  setSavedSessionFromSnapshot,
} from "../session/session.ts";
import {
  NewerPadiStateProjectVersionError,
  openPadiStateStores,
  type PadiStateStores,
} from "../session/stateStore.ts";
import { padiKavalHome, writeStateRootManifest } from "../stateRoot.ts";
import { hasParkedTerminals } from "../terminal-registry.ts";
import { startInventoryReconciler } from "../terminalEndpoint/inventoryReconcile.ts";
import {
  adoptSurvivingSession,
  parkSavedSession,
  rewireSurvivingSession,
} from "../terminalEndpoint/reattach.ts";
import { resolveTerminalEndpoint } from "../terminalEndpoint/resolve.ts";
import { snapshotSession } from "../terminals.ts";
import { publishAgentDistroAtBoot } from "../agentDistro/agentDistro.ts";
import { markRosterEstablished } from "../attention/fleetGate.ts";
import { currentPadiBuildIdentity } from "./buildId.ts";
import { buildControlCoreDeps } from "./controlCore.ts";

interface PadiBoot {
  readonly startedAt: number;
  readonly identity: Readonly<DaemonBuildIdentity>;
}

const PADI_BOOT: PadiBoot = Object.freeze({
  startedAt: Date.now(),
  identity: Object.freeze(currentPadiBuildIdentity()),
});

export interface PadiDaemonOptions {
  /** The state-root to anchor to — padi's identity. An explicit path or
   *  `KOLU_PADI_STATE_DIR` is required; there is no silent default. */
  stateRoot?: string;
  /** Override the socket path (`--socket`); the gate sits beside it. Unset
   *  falls back to the digest-keyed default. */
  socketOverride?: string;
  /** The env whitelist for `--allow-nix-shell-with-env-whitelist`, forwarded so
   *  PTY spawns compose the same nix-devshell env. */
  nixShellWhitelist?: string;
  /** The version stamped as spawned PTYs' `TERM_PROGRAM_VERSION`. Defaults to
   *  padi's own commit. */
  spawnVersion?: string;
  /** The LEGACY per-port kaval socket (`--legacy-kaval-socket`). When set and no
   *  digest kaval gate is held, a compatible live kaval there is ADOPTED rather
   *  than left leaking. Absent for a standalone padi, which adopts nothing. */
  legacyKavalSocket?: string;
  log: Logger;
  /** External stop signal, composed with the drain-triggered abort. */
  signal?: AbortSignal;
  /** Readiness hook — fired once the socket is listening. */
  onReady?: (info: { socketPath: string; pid: number }) => void;
}

type HeldGate = Extract<GateAcquisition, { kind: "acquired" }>;

class PadiGate extends Context.Service<PadiGate, HeldGate>()(
  "padi/boot/PadiGate",
) {}

class GateRefused {
  readonly _tag = "GateRefused";
  constructor(readonly exit: DaemonExit) {}
}

class PadiStores extends Context.Service<
  PadiStores,
  { readonly opened: true }
>()("padi/boot/PadiStores") {}

class PadiIdentity extends Context.Service<
  PadiIdentity,
  { readonly configured: true }
>()("padi/boot/PadiIdentity") {}

class PadiSurfaces extends Context.Service<
  PadiSurfaces,
  {
    readonly group: RpcGroup.RpcGroup<Rpc.Any>;
    readonly handlers: SurfaceHandlers;
    readonly faultSignal: AbortSignal;
  }
>()("padi/boot/PadiSurfaces") {}

class PadiEndpoint extends Context.Service<
  PadiEndpoint,
  { readonly booted: true }
>()("padi/boot/PadiEndpoint") {}

/** Open padi's state-root stores and run the one-shot legacy import. The
 *  imported stores are only reachable as this function's RESULT, so nothing can
 *  inject (and no cell can read) a store the import has not already run over. */
function importedStateStores(stateRoot: string, log: Logger): PadiStateStores {
  const opened = openPadiStateStores(stateRoot);
  if (opened.kind === "newer-project-version") {
    throw new NewerPadiStateProjectVersionError(opened);
  }
  opened.stores.ring.startTicker();
  importLegacyConfigOnce(opened.stores, log);
  return opened.stores;
}

function openStateStores(stateRoot: string, log: Logger): { opened: true } {
  const stores = importedStateStores(stateRoot, log);
  setPadiSessionStore(stores.session);
  setPadiActivityFeedStore(stores.activityFeed);
  setPadiLastPairedDaemonStore(stores.lastPairedDaemon);
  return { opened: true };
}

const storesLayer = (
  stateRoot: string,
  log: Logger,
): Layer.Layer<PadiStores, never, PadiGate> =>
  Layer.effect(
    PadiStores,
    PadiGate.useSync(() => openStateStores(stateRoot, log)),
  );

function configureDaemonIdentity(
  opts: PadiDaemonOptions,
  socketPath: string,
  boot: PadiBoot,
): { configured: true } {
  setDaemonProcessId(String(process.pid));
  setPadiServeSocketPath(socketPath);
  setSpawnServerVersion(
    opts.spawnVersion || boot.identity.navigableCommit || "dev",
  );
  configureNixShellEnv(opts.nixShellWhitelist);
  ensureKoluRoot();
  process.on("exit", shutdownCleanup);
  initAutosaveGate({
    snapshot: snapshotSession,
    isRestorePending: hasParkedTerminals,
    orphanedParkedIds,
    persist: saveSession,
    persistFinal: setSavedSessionFromSnapshot,
    persistActiveId: saveActiveTerminalId,
  });
  return { configured: true };
}

const identityLayer = (
  opts: PadiDaemonOptions,
  socketPath: string,
  boot: PadiBoot,
): Layer.Layer<PadiIdentity, never, PadiStores> =>
  Layer.effect(
    PadiIdentity,
    PadiStores.useSync(() => configureDaemonIdentity(opts, socketPath, boot)),
  );

function serveDaemonSurfaces(params: {
  stateRoot: string;
  onDrain: () => void;
  log: Logger;
  lifetime: DaemonLifetimeInfo;
  boot: PadiBoot;
}): {
  group: RpcGroup.RpcGroup<Rpc.Any>;
  handlers: SurfaceHandlers;
  close: () => Promise<void>;
  faultSignal: AbortSignal;
} {
  const { stateRoot, onDrain, log, lifetime, boot } = params;
  const localEndpoint = resolveTerminalEndpoint(LOCAL_LOCATION);
  const diagnostics = startPadiDiagnostics(padiLog);
  const runtime = implementSurfacesOnPublisher(
    padiDaemonSurfaces,
    {
      channel: <T>(name: string) => publisherChannel<T>(publisher, name),
      onStreamReadError: (err, info) =>
        log.error({ err, stream: info.stream }, "padi stream read error"),
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
        startedAt: boot.startedAt,
        commit: boot.identity.navigableCommit,
        lifetime,
        stateRoot,
        diagnostics,
      }),
      control: buildControlCoreDeps({
        stateRoot,
        startedAt: boot.startedAt,
        commit: boot.identity.navigableCommit,
        buildId: boot.identity.staleKey,
        onDrain,
      }),
    },
  );
  setPadiSurfaceCtx(runtime.ctx.padi);
  publishAgentDistroAtBoot();
  const faultSignal = armRuntimeFaultExit({
    done: runtime.done,
    log,
    subject: "padi surface runtime",
    lastRites: () => captureFinalSession("surface runtime fault"),
  });
  const odu = serveOduSibling({ log });
  return {
    group: padiDaemonGroup,
    handlers: { ...runtime.handlers, ...odu.handlers },
    close: async () => {
      await odu.close();
      await runtime.close();
      diagnostics.dispose();
    },
    faultSignal,
  };
}

const surfacesLayer = (params: {
  stateRoot: string;
  onDrain: () => void;
  log: Logger;
  lifetime: DaemonLifetimeInfo;
  boot: PadiBoot;
}): Layer.Layer<PadiSurfaces, never, PadiIdentity> =>
  Layer.effect(
    PadiSurfaces,
    PadiIdentity.use(() =>
      Effect.acquireRelease(
        Effect.sync(() => serveDaemonSurfaces(params)),
        (served) => Effect.promise(() => served.close()),
      ),
    ),
  );

function bootLocalEndpoint(params: {
  kavalHome: import("@kolu/surface-daemon").DaemonHomePaths;
  legacyKavalHome?: import("@kolu/surface-daemon").DaemonHomePaths;
  stateRoot: string;
  log: Logger;
}): Effect.Effect<{ booted: true }> {
  return Effect.map(
    ensureLocalEndpoint({
      home: params.kavalHome,
      legacyHome: params.legacyKavalHome,
      onStatus: publishDaemonStatus,
      onAdopted: adoptSurvivingSession,
      onHealed: rewireSurvivingSession,
      onNotAdopted: parkSavedSession,
      stillServing: Effect.map(
        observeHeldKaval(params.stateRoot),
        (observation) => observation.kind,
      ),
      onRecovered: (verdict) =>
        verdict === "adopted"
          ? setLinkRestored(encodeHostLocation(LOCAL_LOCATION))
          : setAutoRecovered(encodeHostLocation(LOCAL_LOCATION)),
      onBootSettled: (signal) => {
        startInventoryReconciler(signal);
        const stopSupervision = startKavalSupervision({
          stateRoot: params.stateRoot,
          log: params.log,
          onRecovered: () =>
            setAutoRecovered(encodeHostLocation(LOCAL_LOCATION)),
        });
        signal.addEventListener("abort", stopSupervision, { once: true });
      },
    }),
    () => {
      markRosterEstablished();
      return { booted: true } as const;
    },
  );
}

const endpointLayer = (params: {
  kavalHome: import("@kolu/surface-daemon").DaemonHomePaths;
  legacyKavalHome?: import("@kolu/surface-daemon").DaemonHomePaths;
  stateRoot: string;
  log: Logger;
}): Layer.Layer<PadiEndpoint, never, PadiSurfaces> =>
  Layer.effect(
    PadiEndpoint,
    PadiSurfaces.use(() => bootLocalEndpoint(params)),
  );

/** Record where this daemon's state-root is — in padi's own runtime home and
 *  beside the kaval it actually holds (the adopted legacy socket after an
 *  upgrade, otherwise the digest one) — plus the toolchain it stamps into
 *  terminals and the late-binding links a surviving terminal follows. */
function writeBootManifests(
  padiHomeDir: string,
  digestKavalSocket: string,
  stateRoot: string,
): void {
  writeStateRootManifest(padiHomeDir, stateRoot);
  writeAgentToolsBakeRecord(padiHomeDir);
  setAgentToolsLinkDirs(writeAgentToolsLinks(padiHomeDir));
  writeStateRootManifest(
    dirname(getLocalSocketPath() ?? digestKavalSocket),
    stateRoot,
  );
}

/** Collect the runtime homes of padis and kavals whose own gate file proves
 *  their owner is gone. A live holder, a gateless home (a daemon mid-boot looks
 *  exactly like one) and an unreadable gate are left alone. */
function sweepDeadDaemonHomes(log: Logger): void {
  const runtimeRoots = daemonSweepRegimes();
  for (const { app, gateFile } of [
    { app: "padi", gateFile: PADI_GATE_FILE },
    { app: KAVAL_NS_PREFIX, gateFile: KAVAL_GATE_FILE },
  ]) {
    const sweep = reapStaleDaemonHomes({ app, gateFile, runtimeRoots });
    if (sweep.removed.length > 0) {
      log.info(
        { app, removed: sweep.removed.length },
        "boot sweep: removed dead daemon runtime homes",
      );
    }
    for (const skip of sweep.skipped) {
      if (skip.why === "live" || skip.why === "no-gate") continue;
      log.warn(
        { app, dir: skip.dir, why: skip.why, err: skip.err },
        "boot sweep: left a daemon runtime home in place",
      );
    }
  }
}

function padiDaemonProgram(
  opts: PadiDaemonOptions,
): Effect.Effect<DaemonExit, GateRefused> {
  const { log } = opts;
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  configureDaemonLog(stateRoot);
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

  const readProcessIdentity = (pid: number): ProcessIdentity | undefined =>
    processIdentityFromEnv("KOLU_OSFACTS_BIN", pid);
  const selfIdentity = readProcessIdentity(process.pid);
  if (selfIdentity === undefined) {
    throw new Error(
      `osfacts could not resolve this padi process (${process.pid})`,
    );
  }
  const gateLayer: Layer.Layer<PadiGate, GateRefused> = Layer.effect(
    PadiGate,
    Effect.flatMap(
      Effect.promise(() =>
        claimPidGate(
          home.gatePath,
          home.socketPath,
          selfIdentity,
          readProcessIdentity,
        ),
      ),
      (claimed) => {
        if (claimed.kind === "held") {
          log.info(
            { gatePath: home.gatePath, pid: claimed.pid },
            "padi already running for this state-root; yielding to the live instance",
          );
          return Effect.fail(
            new GateRefused({ kind: "already-running", pid: claimed.pid }),
          );
        }
        if (claimed.kind === "dir-not-private") {
          log.error(
            { gatePath: home.gatePath, dir: claimed.dir },
            "padi gate directory is not private (owner-only); refusing to start",
          );
          return Effect.fail(
            new GateRefused({
              kind: "serve-failed",
              detail: "dir-not-private",
            }),
          );
        }
        return Effect.succeed(claimed);
      },
    ),
  );

  const lifetime = daemonLifetimeFromEnv({ kind: "forever" });

  const drainController = new AbortController();
  if (opts.signal) {
    if (opts.signal.aborted) drainController.abort();
    else
      opts.signal.addEventListener("abort", () => drainController.abort(), {
        once: true,
      });
  }
  const onDrain = (): void => {
    log.info(
      {},
      "control-core drain received — capturing session and exiting; kaval + PTYs survive",
    );
    captureFinalSession("control-core drain");
    drainController.abort();
  };

  const bootLayer = endpointLayer({
    kavalHome,
    legacyKavalHome,
    stateRoot,
    log,
  }).pipe(
    Layer.provideMerge(
      surfacesLayer({
        stateRoot,
        onDrain,
        log,
        lifetime: lifetimeInfo(lifetime),
        boot: PADI_BOOT,
      }),
    ),
    Layer.provideMerge(identityLayer(opts, home.socketPath, PADI_BOOT)),
    Layer.provideMerge(storesLayer(stateRoot, log)),
    Layer.provideMerge(gateLayer),
  );

  const program = Effect.gen(function* () {
    const gate = yield* PadiGate;
    const served = yield* PadiSurfaces;
    yield* PadiEndpoint;

    writeBootManifests(home.dir, kavalHome.socketPath, stateRoot);
    sweepDeadDaemonHomes(log);

    const exit = yield* Effect.promise(() =>
      daemonMain({
        home,
        processIdentity: selfIdentity,
        readProcessIdentity,
        group: served.group,
        handlers: served.handlers,
        lifetime,
        faultSignal: served.faultSignal,
        anchor: () => stateRoot,
        log,
        signal: drainController.signal,
        onReady: opts.onReady,
        gate,
      }),
    );

    if (exit.kind === "shutdown" && exit.reason === "signal") {
      yield* Effect.sync(() => captureFinalSession("signal"));
    }
    return exit;
  });

  return Effect.scoped(Effect.provide(program, bootLayer));
}

export function runPadiDaemon(opts: PadiDaemonOptions): Promise<DaemonExit> {
  installChildMeter();
  return Effect.runPromise(
    Effect.catch(padiDaemonProgram(opts), (refused) =>
      Effect.succeed(refused.exit),
    ),
  );
}
