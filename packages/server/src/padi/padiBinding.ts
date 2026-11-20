import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  currentPadiBuildId,
  drainResidentOnAgentToolsBakeDrift,
  padiRuntimeHome,
  padiStderrLogPath,
  residentPadiSocket,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
import {
  connectPadi,
  type PadiConnectionMetadata,
  type PadiDaemonClient,
  type PadiHelloIdentity,
  type PadiSurfaceClient,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import {
  anchorGone,
  DAEMON_BIND_PID_ENV,
  gatePid,
  isHolderLive,
  readBakedIdentity,
} from "@kolu/surface-daemon";
import {
  buildLabel,
  type ConvergenceOutcome,
  type ConvergenceProbe,
  converge,
  createEndpoint,
  type DaemonDriver,
  isDownEndpointState,
  outcomeAnomaly,
  probeDaemonIdentity,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import { processStateReader } from "@kolu/surface-daemon-supervisor";
import {
  type ClosedInfo,
  ConnectError,
  type Connection,
  type Connector,
  makeSession,
  type Session,
} from "@kolu/surface-remote";
import { Effect } from "effect";
import { assertDaemonSpawnAllowed } from "kaval";
import type { PadiConvergence } from "kolu-common/surface";
import { AGENT_DISTRO_BAKE_ENVS } from "@kolu/padi/agentDistroBake";
import { AGENT_TOOLS_BAKE_ENV, composeSpawnEnv } from "kolu-pty";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import { log } from "../log.ts";
import {
  drainViaControlCore,
  PADI_DRAIN_TEARDOWN_CEILING_MS,
  padiConvergencePolicy,
} from "./padiConvergence.ts";
import { asPadiSession, type PadiSession } from "./padiSession.ts";

type EnvForwardPolicy = "when-set" | "when-defined";

const PADI_ENV_FORWARDS: readonly (readonly [string, EnvForwardPolicy])[] = [
  ["KOLU_STATE_DIR", "when-set"],
  ["KOLU_KAVAL_SPAWN", "when-set"],
  ["KOLU_DIAG_DIR", "when-set"],
  ["KOLU_GH_BIN", "when-set"],
  [AGENT_TOOLS_BAKE_ENV, "when-set"],
  ...AGENT_DISTRO_BAKE_ENVS.map((key) => [key, "when-set"] as const),
  [DAEMON_BIND_PID_ENV, "when-defined"],
  ...AGENT_DIR_ENV_KEYS.map((key) => [key, "when-defined"] as const),
];

export function daemonEnv(
  resolvedStateRoot: string,
  verbose: boolean,
): Record<string, string> {
  const env: Record<string, string> = composeSpawnEnv(process.env);
  for (const [key, policy] of PADI_ENV_FORWARDS) {
    const value = process.env[key];
    if (value === undefined || (policy === "when-set" && value === ""))
      continue;
    env[key] = value;
  }
  env.KOLU_PADI_STATE_DIR = resolvedStateRoot;
  const logLevel = verbose ? "debug" : process.env.LOG_LEVEL;
  if (logLevel) env.LOG_LEVEL = logLevel;
  const nodeOptions = scrubDaemonNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  const kavalIdentity = readBakedIdentity("KAVAL");
  if (kavalIdentity.staleKey) {
    env.KAVAL_BUILD_ID = kavalIdentity.staleKey;
    env.KAVAL_COMMIT_HASH = kavalIdentity.navigableCommit;
  }
  return env;
}

import { AGENT_DIR_ENV_KEYS } from "kolu-agents";
export { AGENT_DIR_ENV_KEYS };

declare const resolvedPadiSocketBrand: unique symbol;

export type ResolvedPadiSocket = string & {
  readonly [resolvedPadiSocketBrand]: true;
};

export function resolvedPadiSocket(home: {
  socketPath: string;
}): ResolvedPadiSocket {
  return home.socketPath as ResolvedPadiSocket;
}

export type PadiLaunchMode =
  | { kind: "systemd"; binPath: string }
  | { kind: "detached-built"; binPath: string }
  | { kind: "detached-from-source" };

export function padiLaunchMode(): PadiLaunchMode {
  const binPath = process.env.KOLU_PADI_BIN;
  if (!binPath) return { kind: "detached-from-source" };
  return process.env.KOLU_PADI_SPAWN === "detached"
    ? { kind: "detached-built", binPath }
    : { kind: "systemd", binPath };
}

export interface PadiLaunchSpec {
  stateRoot: string;
  socket: ResolvedPadiSocket;
  nixShellWhitelist?: string;
  spawnVersion?: string;
  legacyKavalSocket?: string;
  verbose: boolean;
}

export function resolvePadiLaunch(
  launch: PadiLaunchSpec,
  mode: PadiLaunchMode,
): { binPath: string; args: string[] } {
  const args: string[] = [
    "--state-root",
    launch.stateRoot,
    "--socket",
    launch.socket,
  ];
  if (launch.nixShellWhitelist != null)
    args.push("--allow-nix-shell-with-env-whitelist", launch.nixShellWhitelist);
  if (launch.spawnVersion != null)
    args.push("--spawn-version", launch.spawnVersion);
  if (launch.legacyKavalSocket != null)
    args.push("--legacy-kaval-socket", launch.legacyKavalSocket);

  if (mode.kind !== "detached-from-source")
    return { binPath: mode.binPath, args };

  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  const binTs = fileURLToPath(
    new URL("../../../padi/src/daemonBoot/bin.ts", import.meta.url),
  );
  return {
    binPath: process.execPath,
    args: ["--import", tsxLoader, binTs, ...args],
  };
}

export function localPadiDriver(launch: PadiLaunchSpec): DaemonDriver {
  const mode = padiLaunchMode();
  const { binPath, args } = resolvePadiLaunch(launch, mode);
  const driver = survivableSpawnDriver({
    binPath,
    args,
    env: daemonEnv(launch.stateRoot, launch.verbose),
    unitPrefix: "padi",
    fromSource:
      mode.kind === "systemd"
        ? false
        : { inheritParentEnv: mode.kind === "detached-from-source" },
    stderrLog: padiStderrLogPath(launch.stateRoot),
  });
  return {
    spawn: Effect.suspend(() => {
      assertDaemonSpawnAllowed("a real padi daemon");
      return driver.spawn;
    }),
  };
}

export interface EnsurePadiBindingOptions {
  stateRoot?: string;
  nixShellWhitelist?: string;
  spawnVersion?: string;
  legacyKavalSocket?: string;
  verbose?: boolean;
  reconnectDelayMs?: number;
  onFatalBindingError?: (err: PadiBindingFatalError) => void;
}

export type PadiBindingDeps = {
  probe: (
    socketPath: string,
  ) => Effect.Effect<ConvergenceProbe<"drainable"> | null, Error>;
  driver: (launch: PadiLaunchSpec) => DaemonDriver;
  connect: (socketPath: string) => ReturnType<typeof connectPadi>;
  policy: ReturnType<typeof padiConvergencePolicy>;
};

export const PADI_HOST_ID = "padi-local";

export class PadiBindingFatalError extends Error {}

export class PadiAdoptionRefusedError extends PadiBindingFatalError {
  constructor(message: string) {
    super(message);
    this.name = "PadiAdoptionRefusedError";
  }
}

export class PadiStateRootGoneError extends PadiBindingFatalError {
  constructor(stateRoot: string) {
    super(
      `padi's state root is gone: ${stateRoot} no longer exists — the workspace ` +
        "was deleted while this kolu was still running (e.g. its worktree removed). " +
        "There is nothing left to serve; exiting rather than respawning a padi " +
        "into a recreated empty directory. Restart kolu from a live workspace " +
        "(or point KOLU_PADI_STATE_DIR at one).",
    );
    this.name = "PadiStateRootGoneError";
  }
}

export function padiConnectFailure(
  outcome: ConvergenceOutcome,
  stateRoot: string,
  socketPath: string,
): Error {
  if (outcome.kind === "refused") {
    switch (outcome.anomaly.kind) {
      case "skew-refused":
        return new PadiAdoptionRefusedError(
          "a padi is already serving this workspace at a padiSurface contract this " +
            `kolu cannot speak (state dir: ${stateRoot}; its socket: ${socketPath}) — ` +
            "left standing, never touched (#1313: a binder never kills a running padi). " +
            "If a kolu is already running against it, use that one. To run a second, " +
            "independent instance here, set KOLU_STATE_DIR=<dir> (and " +
            "KOLU_PADI_STATE_DIR=<dir> for an isolated padi too).",
        );
      case "cross-supervisor":
        return new ConnectError(
          `padi cross-supervisor: ${outcome.anomaly.detail} (state dir: ${stateRoot}; socket: ${socketPath}) — ` +
            "another supervisor is respawning this workspace's padi; isolate with " +
            "KOLU_STATE_DIR / KOLU_REMOTE_PADI_STATE_DIR rather than fighting",
          "remote",
        );
      case "unconverged":
        return new ConnectError(
          `padi unconverged: ${outcome.anomaly.detail} (state dir: ${stateRoot}; socket: ${socketPath})`,
          "remote",
        );
      default: {
        const _exhaustive: never = outcome.anomaly;
        throw new Error(
          `unreachable refuse anomaly: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }
  return new ConnectError(
    "padi did not come up (left degraded / refused)",
    "network",
  );
}

export function reportFatalBindingError(
  err: Error,
  onFatalBindingError: ((err: PadiBindingFatalError) => void) | undefined,
): void {
  if (err instanceof PadiBindingFatalError) onFatalBindingError?.(err);
}

export function handlePadiBootFailure(
  err: unknown,
  deps: {
    log: { error: typeof log.error; fatal: typeof log.fatal };
    exit: (code: number) => void;
  },
): void {
  if (err instanceof PadiBindingFatalError) {
    deps.log.fatal({ err }, err.message);
    deps.exit(1);
    return;
  }
  deps.log.error({ err }, "padi endpoint failed to come up at boot");
}

export function ensurePadiBinding(opts: EnsurePadiBindingOptions): PadiSession {
  const binderBuildId = currentPadiBuildId();
  return ensurePadiBindingWith(opts, {
    policy: padiConvergencePolicy(binderBuildId),
    probe: probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: PADI_DRAIN_TEARDOWN_CEILING_MS,
    }),
    driver: localPadiDriver,
    connect: (path) => connectPadi(path),
  });
}

function oncePerBoot<A, E>(step: Effect.Effect<A, E>): Effect.Effect<void, E> {
  let ran = false;
  return Effect.suspend(() => {
    if (ran) return Effect.void;
    ran = true;
    return Effect.asVoid(step);
  });
}

export function ensurePadiBindingWith(
  opts: EnsurePadiBindingOptions,
  deps: PadiBindingDeps,
): PadiSession {
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const home = padiRuntimeHome(stateRoot, residentPadiSocket(stateRoot));

  let currentClosed: ((info: ClosedInfo) => void) | null = null;
  let standingConvergence: PadiConvergence | null = null;
  const driver = deps.driver({
    stateRoot,
    socket: resolvedPadiSocket(home),
    nixShellWhitelist: opts.nixShellWhitelist,
    spawnVersion: opts.spawnVersion,
    legacyKavalSocket: opts.legacyKavalSocket,
    verbose: opts.verbose ?? false,
  });
  const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
  const ep = createEndpoint<
    PadiDaemonClient,
    PadiHelloIdentity,
    PadiConnectionMetadata
  >({
    hostId: PADI_HOST_ID,
    home,
    readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
    readSocketHolders: osfactsSocketHolders(osfactsBin),
    readProcessState: processStateReader(osfactsBin),
    policy: deps.policy,
    probe: (socketPath) => deps.probe(socketPath),
    driver,
    connect: (path) => deps.connect(path),
    log,
    onStatus: (_hostId, status) => {
      if (isDownEndpointState(status.state)) {
        const resolve = currentClosed;
        currentClosed = null;
        resolve?.({ kind: "endpoint-down" });
      }
    },
  });

  const convergePadi = Effect.gen(function* () {
    const outcome = yield* converge(ep);
    standingConvergence = outcomeAnomaly(outcome);
    if (outcome.kind === "drained-replacing" && outcome.axis === "build") {
      const expectedBuild = buildLabel(deps.policy.baked.build);
      log.info(
        {
          binderBuildId: expectedBuild,
          runningBuild: buildLabel(outcome.running.build),
          running: outcome.running,
        },
        `padi build change on boot: running=${buildLabel(outcome.running.build)} expected=${expectedBuild}` +
          " — draining the survivor once (persist + exit; its kaval + PTYs survive) and " +
          "respawning this binder's own build (drain-on-build-mismatch, #1670).",
      );
    }
    return outcome;
  });

  const checkAgentToolsBake = oncePerBoot(
    Effect.gen(function* () {
      const ownBake = process.env[AGENT_TOOLS_BAKE_ENV] ?? "";
      const drift = yield* drainResidentOnAgentToolsBakeDrift({
        runtimeDir: home.dir,
        socketPath: home.socketPath,
        ownBake,
        ownBuildId: currentPadiBuildId(),
        probe: deps.probe,
      });
      if (drift.kind === "drained") {
        log.info(
          { recorded: drift.recorded, ownBake },
          `padi toolchain change on boot: recorded=${drift.recorded} expected=${ownBake}` +
            " — draining the survivor once (persist + exit; its kaval + PTYs survive) and " +
            "respawning with this build's toolchain (drain-on-tools-drift, #2146).",
        );
      } else if (
        drift.kind === "probe-failed" ||
        drift.kind === "drain-failed"
      ) {
        log.warn(
          { recorded: drift.recorded, ownBake, error: drift.error },
          `padi toolchain drift detected but ${drift.kind === "probe-failed" ? "the probe failed" : "the drain did not take"} — proceeding to converge`,
        );
      }
    }),
  );

  const connectorEffect = (
    ctx: Parameters<Connector<PadiSurfaceClient>>[0],
  ): Effect.Effect<Connection<PadiSurfaceClient>, unknown> =>
    Effect.gen(function* () {
      ctx.connecting();
      if (anchorGone(stateRoot)) {
        const gone = new PadiStateRootGoneError(stateRoot);
        reportFatalBindingError(gone, opts.onFatalBindingError);
        return yield* Effect.fail(gone);
      }
      yield* checkAgentToolsBake;
      const outcome = yield* convergePadi;
      const conn = ep.current();
      if (conn === undefined) {
        const err = padiConnectFailure(outcome, stateRoot, home.socketPath);
        reportFatalBindingError(err, opts.onFatalBindingError);
        return yield* Effect.fail(err);
      }
      const closed = new Promise<ClosedInfo>((resolve) => {
        currentClosed = resolve;
      });
      return {
        client: scopePadiSurface(conn.client),
        dispatch: conn.client.dispatch,
        closed,
        isAlive: () =>
          runAtSessionPlug(
            Effect.asVoid(conn.client.control.surface.core.hello()),
          ),
        processAlive: () => {
          const pid = gatePid(home.gatePath);
          return pid !== undefined && isHolderLive(pid);
        },
        teardown: () => conn.dispose(),
      };
    });

  const runAtSessionPlug = <A>(
    program: Effect.Effect<A, unknown>,
  ): Promise<A> => Effect.runPromise(program);

  const connector: Connector<PadiSurfaceClient> = (ctx) =>
    runAtSessionPlug(connectorEffect(ctx));

  const base: Session<PadiSurfaceClient, never> = makeSession<
    PadiSurfaceClient,
    never
  >({
    connectOnce: connector,
    initialConnection: "connecting",
    reconnectDelayMs: opts.reconnectDelayMs,
    label: PADI_HOST_ID,
    log,
  });

  return asPadiSession(base, {
    convergence: () => standingConvergence,
    entryFailedDetail: () => null,
    renew: () =>
      Effect.suspend(() => {
        const conn = ep.current();
        return conn === undefined
          ? Effect.fail(
              new Error(
                "padi is not bound — cannot drain (the daemon is down)",
              ),
            )
          : drainViaControlCore(conn);
      }),
  });
}
