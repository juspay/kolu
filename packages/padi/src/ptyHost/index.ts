import { lstatSync } from "node:fs";
import { encodeHostLocation, LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { SurfaceDispatch } from "@kolu/surface/link";
import type { DaemonHomePaths } from "@kolu/surface-daemon";
import {
  createEndpoint,
  type Endpoint,
  type EndpointStatus,
  type RestartSteps,
  serializeRestart,
} from "@kolu/surface-daemon-supervisor";
import { processStateReader } from "@kolu/surface-daemon-supervisor";
import {
  Cache,
  Cause,
  Context,
  Duration,
  Effect,
  Fiber,
  MutableRef,
  Ref,
} from "effect";
import {
  DEFAULT_MIRROR_SCROLLBACK,
  kavalConvergencePolicy,
  type PtyHostClient,
  type PtyHostIdentity,
  type PtyHostSpawnInput,
  type PtyHostSystemInfo,
  ptyHostClientOver,
} from "kaval";
import {
  CONTAINING_TERMINAL_ENV,
  cleanEnv,
  koluIdentityEnv,
  prepareShellInit,
  prependPathEntries,
  TERMINAL_TOOLS_PATH_ENV,
} from "kolu-pty";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import type { AgentLayer } from "../agentDistro/layer.ts";
import { agentBinDir } from "@kolu/agent-distro/bundle";
import {
  AGENT_DISTRO_PLUGINS_ENV,
  AI_PROFILE_ENV,
} from "../agentDistro/bake.ts";
import { readAgentToolsLinkDirs } from "../agentToolsBake.ts";
import type { KavalObservation } from "../kavalObservation.ts";
import { log } from "../log.ts";
import { padiSshAuthSockPath } from "../stateRoot.ts";
import {
  connectKaval,
  type KavalConnectionMetadata,
  probeKavalForConvergence,
} from "./connect.ts";
import {
  getLocalSocketPath,
  getPadiServeSocketPath,
  setLocalSocketPath,
} from "./daemonStatus.ts";
import { withRestartClaim } from "./endpointClaim.ts";
import { startLinkLossHealer } from "./linkLoss.ts";
import { localKavalDriver } from "./localDriver.ts";
import {
  type ConvergeVerdict,
  convergeAndReconcile,
} from "./reconcileConverged.ts";
import {
  readShellEnv,
  SHELL_ENV_TIMEOUT_MS,
  shellEnvSpawnId,
} from "./shellEnv.ts";

type Identity = PtyHostIdentity;

let spawnServerVersion: string | undefined;

export function requireSpawnServerVersion(): string {
  if (spawnServerVersion === undefined) {
    throw new Error(
      "spawnServerVersion read before setSpawnServerVersion() — kolu-server boot must inject it before ensureLocalEndpoint",
    );
  }
  return spawnServerVersion;
}

/** Inject the kolu app version used for the spawned PTY's identity env. Called
 *  once at boot, BEFORE {@link ensureLocalEndpoint}. */
export function setSpawnServerVersion(v: string): void {
  if (!v) throw new Error("setSpawnServerVersion: empty");
  spawnServerVersion = v;
}

type KavalEndpoint = Endpoint<PtyHostClient, Identity, KavalConnectionMetadata>;

interface HeldEndpoint {
  readonly endpoint: KavalEndpoint;
  readonly restart: <Ctx>(
    steps: RestartSteps<PtyHostClient, Identity, Ctx, KavalConnectionMetadata>,
  ) => Effect.Effect<void, unknown>;
}

class PtyHostEndpointState extends Context.Service<
  PtyHostEndpointState,
  {
    readonly current: Ref.Ref<HeldEndpoint | undefined>;
    readonly restart: <Ctx>(
      steps: RestartSteps<
        PtyHostClient,
        Identity,
        Ctx,
        KavalConnectionMetadata
      >,
    ) => Effect.Effect<void, unknown>;
    readonly info: Effect.Effect<PtyHostSystemInfo, unknown>;
  }
>()("padi/ptyHost/PtyHostEndpointState") {}

function setRef<A>(ref: Ref.Ref<A>, value: A): void {
  MutableRef.set(ref.ref, value);
}

const heldEndpoint: Ref.Ref<HeldEndpoint | undefined> = Ref.makeUnsafe<
  HeldEndpoint | undefined
>(undefined);

const cachedInfo: Ref.Ref<Fiber.Fiber<PtyHostSystemInfo, unknown> | undefined> =
  Ref.makeUnsafe<Fiber.Fiber<PtyHostSystemInfo, unknown> | undefined>(
    undefined,
  );

const endpointState = PtyHostEndpointState.of({
  current: heldEndpoint,
  restart: (steps) =>
    Effect.suspend(() => {
      const held = Ref.getUnsafe(heldEndpoint);
      if (held === undefined) {
        throw new Error("kaval endpoint not initialized — cannot restart");
      }
      return held.restart(steps);
    }),
  info: Effect.gen(function* () {
    const existing = Ref.getUnsafe(cachedInfo);
    if (existing !== undefined) return yield* Fiber.join(existing);
    const fiber = yield* Effect.forkDetach(
      ptyHostClient.surface.system.info({}),
    );
    setRef(cachedInfo, fiber);
    return yield* Fiber.join(fiber);
  }),
});

function holdEndpoint(ep: KavalEndpoint): void {
  const trigger = serializeRestart(ep);
  setRef(endpointState.current, {
    endpoint: ep,
    restart: (steps) => withRestartClaim(trigger(steps)),
  });
}

export type KavalProcessTarget = Readonly<{
  pid: number;
  startedAt: number;
}>;

export function currentKavalProcessTarget(): KavalProcessTarget | undefined {
  const connection = Ref.getUnsafe(endpointState.current)?.endpoint.current();
  return connection === undefined
    ? undefined
    : Object.freeze({
        pid: connection.metadata.pid,
        startedAt: connection.startedAt,
      });
}

function liveDispatch(): SurfaceDispatch {
  const conn = Ref.getUnsafe(endpointState.current)?.endpoint.current();
  if (!conn) {
    throw new Error(
      "pty-host endpoint is not connected — the kaval daemon is starting or down",
    );
  }
  return conn.metadata.dispatch;
}

/** The pty-host client `LocalTerminalEndpoint` (and this module) consume — ONE
 *  face, built at import time over a dispatch that RESOLVES the endpoint's
 *  current connection per call, so a captured reference never goes stale across
 *  a daemon recycle. */
export const ptyHostClient: PtyHostClient = ptyHostClientOver({
  unary: (tag, payload) => liveDispatch().unary(tag, payload),
  stream: (tag, payload) => liveDispatch().stream(tag, payload),
});

export function __setEndpointForTest(ep: KavalEndpoint): () => void {
  const previous = Ref.getUnsafe(endpointState.current);
  holdEndpoint(ep);
  return () => {
    setRef(endpointState.current, previous);
  };
}

/** Boot the local pty-host endpoint under the always-recycle policy and connect.
 *  SUCCEEDS whether or not the daemon came up — a boot failure reports `dead`
 *  via `onStatus` and leaves `ptyHostClient` throwing, so the server can still
 *  listen and the UI honestly shows the dead/degraded state. That is what the
 *  `never` error channel says. */
export function ensureLocalEndpoint(opts: {
  home: DaemonHomePaths;
  legacyHome?: DaemonHomePaths;
  onStatus: (
    hostId: string,
    status: EndpointStatus<Identity, KavalConnectionMetadata>,
  ) => void;
  onAdopted?: Effect.Effect<void, unknown>;
  onHealed: Effect.Effect<void, unknown>;
  onNotAdopted?: () => void;
  onBootSettled?: (signal: AbortSignal) => void;
  onRecovered: (verdict: ConvergeVerdict) => void;
  stillServing: Effect.Effect<KavalObservation["kind"]>;
}): Effect.Effect<void> {
  return Effect.gen(function* () {
    const { home, legacyHome } = opts;
    setLocalSocketPath(home.socketPath);
    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    const healer = startLinkLossHealer({
      reconverge: Effect.suspend(() =>
        convergeAndReconcile(ep, {
          ...opts,
          onAdopted: opts.onHealed,
          onAdoptFailure: "report",
        }),
      ),
      kavalResidency: opts.stillServing,
      onRecovered: opts.onRecovered,
    });
    const ep = createEndpoint<PtyHostClient, Identity, KavalConnectionMetadata>(
      {
        hostId: encodeHostLocation(LOCAL_LOCATION),
        home,
        readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
        readSocketHolders: osfactsSocketHolders(osfactsBin),
        readProcessState: processStateReader(osfactsBin),
        policy: kavalConvergencePolicy(),
        probe: (socketPath) => probeKavalForConvergence(socketPath),
        driver: localKavalDriver(home.socketPath),
        connect: (path) => connectKaval(path),
        log,
        onStatus: (hostId, status) => {
          healer.observe(status.state);
          opts.onStatus(hostId, status);
        },
        adoptHint:
          legacyHome === undefined
            ? undefined
            : {
                home: legacyHome,
                connect: (path) => connectKaval(path),
                onAdopted: () => setLocalSocketPath(legacyHome.socketPath),
              },
        onSpawned: () => setLocalSocketPath(home.socketPath),
      },
    );
    holdEndpoint(ep);
    yield* Effect.catchCause(
      Effect.gen(function* () {
        yield* convergeAndReconcile(ep, {
          ...opts,
          onAdoptFailure: "recycle",
        });
      }),
      (cause) =>
        Effect.sync(() => {
          log.error(
            { err: Cause.squash(cause) },
            "kaval endpoint failed to come up at boot",
          );
        }),
    );

    opts.onBootSettled?.(new AbortController().signal);
  });
}

export function restartLocalEndpoint<Ctx>(
  steps: RestartSteps<PtyHostClient, Identity, Ctx, KavalConnectionMetadata>,
): Effect.Effect<void, unknown> {
  return endpointState.restart(steps);
}

export interface TerminalEnvSpec {
  kavalSocket: string;
  padiSocket?: string;
  sshAuthSock?: string;
  toolsPath: readonly string[];
  agents?: {
    readonly binDir: string;
    readonly plugins: string;
    readonly profiles: readonly string[];
  };
  serverVersion: string;
}

export function agentSpawnEnv(
  layer: AgentLayer,
): NonNullable<TerminalEnvSpec["agents"]> {
  return {
    binDir: agentBinDir(layer.bundle),
    plugins: layer.plugins,
    profiles: layer.profiles.map((p) => p.path),
  };
}

function sshAuthSockLayer(
  env: Record<string, string>,
  spec: TerminalEnvSpec,
): void {
  if (spec.sshAuthSock !== undefined) env.SSH_AUTH_SOCK = spec.sshAuthSock;
}

function identityLayer(
  env: Record<string, string>,
  spec: TerminalEnvSpec,
  terminalId: string,
): void {
  Object.assign(env, koluIdentityEnv(spec.serverVersion));
  env[CONTAINING_TERMINAL_ENV] = terminalId;
  env.KAVAL_SOCKET = spec.kavalSocket;
  if (spec.padiSocket !== undefined) env.PADI_SOCKET = spec.padiSocket;
}

function toolchainLayer(
  env: Record<string, string>,
  spec: TerminalEnvSpec,
): void {
  const toolsPath =
    spec.agents === undefined
      ? spec.toolsPath
      : [...spec.toolsPath, spec.agents.binDir];
  if (toolsPath.length === 0) return;
  env.PATH = prependPathEntries(env.PATH, toolsPath);
  env[TERMINAL_TOOLS_PATH_ENV] = toolsPath.join(":");
}

function agentDistroLayer(
  env: Record<string, string>,
  spec: TerminalEnvSpec,
): void {
  if (spec.agents === undefined) return;
  env[AGENT_DISTRO_PLUGINS_ENV] = spec.agents.plugins;
  if (spec.agents.profiles.length > 0)
    env[AI_PROFILE_ENV] = spec.agents.profiles.join(" ");
}

export function composeSpawnInput(
  args: { id: string; cwd?: string },
  info: PtyHostSystemInfo,
  spec: TerminalEnvSpec,
): PtyHostSpawnInput {
  const env = cleanEnv();
  sshAuthSockLayer(env, spec);
  const shell = env.SHELL ?? info.shell;
  const home = env.HOME ?? info.home;
  const cwd = args.cwd || home || "/";
  const plan = prepareShellInit({
    shell,
    home,
    terminalId: args.id,
    rcDir: info.rcDir,
  });
  Object.assign(env, plan.env);
  identityLayer(env, spec, args.id);
  toolchainLayer(env, spec);
  agentDistroLayer(env, spec);
  return {
    id: args.id,
    argv: [shell, ...plan.args],
    cwd,
    env,
    initFiles: plan.initFiles,
    scrollback: DEFAULT_MIRROR_SCROLLBACK,
  };
}

export function buildTerminalSpawnInput(args: {
  id: string;
  cwd?: string;
  agents?: AgentLayer;
}): Effect.Effect<PtyHostSpawnInput, unknown> {
  return Effect.gen(function* () {
    const kavalSocket = getLocalSocketPath();
    if (kavalSocket === undefined) {
      throw new Error(
        "local kaval socket path read before the endpoint recorded it at boot",
      );
    }
    const padiSocket = getPadiServeSocketPath();
    const sshAuthSockLink =
      padiSocket === undefined ? undefined : padiSshAuthSockPath(padiSocket);
    const sshAuthSock =
      sshAuthSockLink !== undefined &&
      lstatSync(sshAuthSockLink, { throwIfNoEntry: false }) !== undefined
        ? sshAuthSockLink
        : undefined;
    return composeSpawnInput(
      { id: args.id, cwd: args.cwd },
      yield* endpointState.info,
      {
        kavalSocket,
        padiSocket,
        sshAuthSock,
        toolsPath: readAgentToolsLinkDirs(),
        ...(args.agents !== undefined
          ? { agents: agentSpawnEnv(args.agents) }
          : {}),
        serverVersion: requireSpawnServerVersion(),
      },
    );
  });
}

interface ShellEnvAsk {
  readonly cwd: string;
  readonly agents: AgentLayer;
}

type Captures = Cache.Cache<ShellEnvAsk, Record<string, string>, unknown>;

const capturesCell: Ref.Ref<Captures | undefined> = Ref.makeUnsafe<
  Captures | undefined
>(undefined);

const captures: Effect.Effect<Captures> = Effect.gen(function* () {
  const existing = Ref.getUnsafe(capturesCell);
  if (existing !== undefined) return existing;
  const made = yield* Cache.make({
    capacity: 16,
    timeToLive: Duration.zero,
    lookup: captureShellEnv,
  });
  setRef(capturesCell, made);
  return made;
});

export function terminalShellEnv(
  args: ShellEnvAsk,
): Effect.Effect<Record<string, string>, unknown> {
  return Effect.flatMap(captures, (cache) => Cache.get(cache, args));
}

function captureShellEnv(
  args: ShellEnvAsk,
): Effect.Effect<Record<string, string>, unknown> {
  return Effect.gen(function* () {
    const input = yield* buildTerminalSpawnInput({
      id: shellEnvSpawnId(),
      cwd: args.cwd,
      agents: args.agents,
    });
    const { rcDir } = yield* endpointState.info;
    return yield* Effect.tryPromise({
      try: (signal) =>
        readShellEnv(input, rcDir, {
          timeoutMs: SHELL_ENV_TIMEOUT_MS,
          signal,
        }),
      catch: (err: unknown) => err,
    });
  });
}
