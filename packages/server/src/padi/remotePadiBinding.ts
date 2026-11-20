import { currentPadiBuildId } from "@kolu/padi/assembly";
import { PADI_REMOTE_DIAL } from "@kolu/padi/remote-dial";
import {
  type PadiDaemonClient,
  type PadiSurfaceClient,
  padiClientOver,
  scopePadiSurface,
} from "@kolu/padi-client/dial";
import {
  PADI_SURFACE_VERSION,
  padiDaemonGroup,
  type padiSurface,
  padiSurfaceSibling,
} from "@kolu/padi-client/surface";
import {
  type ControlCoreProbeClient,
  convergeAdmit,
  createConnectorDrainBudget,
  probeDaemonIdentityFrom,
} from "@kolu/surface-daemon-supervisor";
import {
  type Admit,
  type AdmitVerdict,
  ConnectError,
  type Connector,
  makeSession,
  ResolveDrvError,
  resolveBakedAgentDrv,
  type Session,
  type SshConnectorOptions,
  type SshProv,
  sshConnector,
} from "@kolu/surface-remote";
import { Effect, Schema } from "effect";
import { encodeHostKey, parseHostInput } from "kolu-common/hostKey";
import {
  type PadiConvergence,
  PadiConvergenceSchema,
} from "kolu-common/surface";
import {
  type EntryFailedCause,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/surfacesWithPadi";
import { composeSpawnEnv } from "kolu-pty";
import { log } from "../log.ts";
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
  padiConvergencePolicyForBinding,
} from "./padiConvergence.ts";
import {
  asPadiSession,
  type PadiEntryFailedDetail,
  type PadiSession,
} from "./padiSession.ts";

const REMOTE_DRAIN_TEARDOWN_CEILING_MS = 6000;
const MAX_BUILD_DRAINS_PER_INSTANCE = 3;

type AdmitDrainPlugs = {
  readonly drain: Effect.Effect<void, unknown>;
  readonly awaitExit: Effect.Effect<void>;
};

function supersededAdmitError(): Error {
  return new Error("remote padi admit superseded");
}

function isEpochVerdict(convergence: PadiConvergence | null): boolean {
  return (
    convergence?.kind === "unconverged" &&
    convergence.cause.kind === "unspeakable-protocol"
  );
}

function whenAborted(signal: AbortSignal): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const onAbort = (): void => resume(Effect.void);
    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
  });
}

export function generationBoundAdmitDrainPlugs(
  generationSignal: AbortSignal,
  plugs: AdmitDrainPlugs,
): AdmitDrainPlugs {
  const superseded = Effect.suspend(() => Effect.die(supersededAdmitError()));
  return {
    drain: Effect.suspend(() =>
      generationSignal.aborted
        ? Effect.fail(supersededAdmitError())
        : plugs.drain,
    ),
    awaitExit: Effect.suspend(() =>
      generationSignal.aborted
        ? superseded
        : Effect.raceFirst(
            plugs.awaitExit,
            Effect.andThen(whenAborted(generationSignal), superseded),
          ),
    ),
  };
}

/** The host-selection knob: an ssh host (an `~/.ssh/config` alias or `user@host`).
 *  Unset → the LOCAL padi binding (byte-identical to today). */
export const KOLU_PADI_HOST_ENV = "KOLU_PADI_HOST";

export const KOLU_REMOTE_PADI_STATE_DIR_ENV = "KOLU_REMOTE_PADI_STATE_DIR";

export function parseKoluPadiHostSeed(): HostKey[] {
  const raw = process.env[KOLU_PADI_HOST_ENV]?.trim();
  const listed = raw
    ? raw
        .split(",")
        .map((h) => h.trim())
        .filter((h) => h.length > 0)
    : [];
  const seen = new Set<string>([encodeHostKey(LOCAL_HOST)]);
  const remotes: HostKey[] = [];
  for (const h of listed) {
    const parsed = parseHostInput(h);
    const enc = encodeHostKey(parsed);
    if (seen.has(enc)) continue;
    seen.add(enc);
    remotes.push(parsed);
  }
  return [LOCAL_HOST, ...remotes];
}

export class UnremovableHostError extends Error {
  constructor(host: string, why: string) {
    super(`cannot remove host ${JSON.stringify(host)}: ${why}`);
    this.name = "UnremovableHostError";
  }
}

export function assertRemovableHost(host: HostKey, defaultHost: HostKey): void {
  if (
    host.kind === "local" ||
    encodeHostKey(host) === encodeHostKey(defaultHost)
  ) {
    throw new UnremovableHostError(
      encodeHostKey(host),
      "it is the unremovable local default",
    );
  }
}

type DrvFaultCause = Extract<
  EntryFailedCause,
  | "agent-source-unbaked"
  | "agent-cache-unbaked"
  | "agent-drv-unavailable"
  | "auth-required"
  | "host-key-unverified"
  | "nix-unavailable"
>;

type ConnectorOwnedVerdict = "network-exhausted";

type EnrichableDrvVerdict = Exclude<
  ResolveDrvError["resolution"]["kind"],
  ConnectorOwnedVerdict
>;

const CONNECTOR_OWNED_VERDICT: ConnectorOwnedVerdict = "network-exhausted";

const DRV_FAULT_ENRICHMENT: Record<
  EnrichableDrvVerdict,
  { cause: DrvFaultCause; unsetHint: boolean }
> = {
  "source-unbaked": { cause: "agent-source-unbaked", unsetHint: true },
  "binary-cache-unbaked": { cause: "agent-cache-unbaked", unsetHint: true },
  unavailable: { cause: "agent-drv-unavailable", unsetHint: false },
  "auth-refused": { cause: "auth-required", unsetHint: false },
  "host-key-unverified": { cause: "host-key-unverified", unsetHint: false },
  "nix-unavailable": { cause: "nix-unavailable", unsetHint: false },
};

class PadiDrvFault extends ResolveDrvError {
  constructor(
    message: string,
    readonly domainCause: DrvFaultCause,
    resolution: ResolveDrvError["resolution"],
  ) {
    super(message, resolution);
    this.name = "PadiDrvFault";
  }
}

function makeResolvePadiDrv(): SshConnectorOptions<
  typeof padiSurface.spec
>["resolveDrvPath"] {
  return async (ctx) => {
    try {
      return await resolveBakedAgentDrv(PADI_REMOTE_DIAL.package, ctx);
    } catch (err) {
      if (!(err instanceof ResolveDrvError)) throw err;
      const resolution = err.resolution;
      if (resolution.kind === CONNECTOR_OWNED_VERDICT) throw err;
      const fault = DRV_FAULT_ENRICHMENT[resolution.kind];
      throw new PadiDrvFault(
        fault.unsetHint
          ? `${err.message} Or unset ${KOLU_PADI_HOST_ENV} to bind only the local padi.`
          : err.message,
        fault.cause,
        resolution,
      );
    }
  };
}

export interface RemotePadiSessionDeps {
  binderVersion?: string;
  binderBuildId?: string;
  maxBuildDrainsPerInstance?: number;
  drainTeardownCeilingMs?: number;
}

type PadiExtraArg =
  | { readonly flag: "--state-root"; readonly value: string }
  | { readonly flag: "--spawn-version"; readonly value: string };

/** ssh's exec channel carries a command line and no environment, so the remote
 *  state root rides `--state-root` here rather than an env var. */
export function composePadiExtraArgs(
  spawnVersion: string | null | undefined,
  remoteStateDir?: string | null,
): string[] {
  const args: PadiExtraArg[] = [];
  if (remoteStateDir != null && remoteStateDir !== "")
    args.push({ flag: "--state-root", value: remoteStateDir });
  if (spawnVersion != null)
    args.push({ flag: "--spawn-version", value: spawnVersion });
  return args.flatMap(({ flag, value }) => [flag, value]);
}

function entryCauseOf(
  convergence: PadiConvergence | null,
  drvFaultCause: DrvFaultCause | null,
): PadiEntryFailedDetail | null {
  switch (convergence?.kind) {
    case "cross-supervisor":
      return { cause: "cross-supervisor" };
    case "skew-refused":
      return {
        cause: "contract-skew-refused",
        running: convergence.running.contractVersion,
        expected: convergence.expected.contractVersion,
      };
    case "unconverged":
      return isEpochVerdict(convergence)
        ? { cause: "previous-protocol-epoch" }
        : { cause: "unconverged" };
    case "adopted-stale":
      return null;
    case "link-failed":
    case undefined:
      return drvFaultCause !== null ? { cause: drvFaultCause } : null;
    default: {
      const _exhaustive: never = convergence;
      throw new Error(
        `unreachable PadiConvergence: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

export interface EnsureRemotePadiBindingOptions {
  /** The ssh host to bind (an `~/.ssh/config` alias or `user@host`). */
  host: string;
  /** The kolu app version to stamp as the remote-spawned PTYs' `TERM_PROGRAM_VERSION`. */
  spawnVersion?: string;
}

export function ensureRemotePadiBinding(
  opts: EnsureRemotePadiBindingOptions,
  deps: RemotePadiSessionDeps = {},
): PadiSession {
  const { host } = opts;
  log.info(
    { host },
    `binding a REMOTE padi over ssh — one keyed host in the pool that ${KOLU_PADI_HOST_ENV} seeds`,
  );
  const extraArgs = composePadiExtraArgs(
    opts.spawnVersion,
    process.env[KOLU_REMOTE_PADI_STATE_DIR_ENV],
  );

  const binderVersion = deps.binderVersion ?? PADI_SURFACE_VERSION;
  const binderBuildId = deps.binderBuildId ?? currentPadiBuildId();
  const maxDrains =
    deps.maxBuildDrainsPerInstance ?? MAX_BUILD_DRAINS_PER_INSTANCE;
  const drainCeilingMs =
    deps.drainTeardownCeilingMs ?? REMOTE_DRAIN_TEARDOWN_CEILING_MS;

  const policy = padiConvergencePolicyForBinding({
    contractVersion: binderVersion,
    binderBuildId,
    maxBuildDrainsPerInstance: maxDrains,
  });
  const budget = createConnectorDrainBudget(policy);

  let convergence: PadiConvergence | null = null;

  type ActiveCombined = {
    client: PadiDaemonClient;
    dispose: () => void;
    processExit: Promise<void>;
    signal: AbortSignal;
  };
  const combinedByScopedClient = new WeakMap<
    PadiSurfaceClient,
    ActiveCombined
  >();
  let activeCombined: ActiveCombined | null = null;
  let drvFaultCause: DrvFaultCause | null = null;

  const resolveDrv = makeResolvePadiDrv();
  const inner = sshConnector({
    surface: { ...padiSurfaceSibling, group: padiDaemonGroup },
    host,
    binary: PADI_REMOTE_DIAL.binary,
    extraArgs,
    localEnv: composeSpawnEnv(process.env),
    resolveDrvPath: async (ctx) => {
      drvFaultCause = null;
      try {
        return await resolveDrv(ctx);
      } catch (err) {
        if (err instanceof PadiDrvFault) drvFaultCause = err.domainCause;
        throw err;
      }
    },
  });
  const rawConnector: Connector<PadiSurfaceClient, SshProv> = async (ctx) => {
    const conn = await inner(ctx).catch((err: unknown) => {
      if (err instanceof ConnectError && err.anomaly !== null) {
        const decoded = Schema.decodeUnknownExit(PadiConvergenceSchema)(
          err.anomaly,
        );
        if (decoded._tag === "Success") {
          convergence = decoded.value;
          log.warn(
            {
              host,
              verdict: "gate-refused",
              convergenceKind: decoded.value.kind,
              cause:
                decoded.value.kind === "unconverged"
                  ? decoded.value.cause
                  : undefined,
              reason: err.message,
            },
            `remote padi on ${host} refused at the readiness gate — ${err.message}`,
          );
        } else {
          log.error(
            { host, anomaly: err.anomaly },
            `remote padi on ${host} refused at the readiness gate with an anomaly this kolu cannot decode`,
          );
        }
      }
      throw err;
    });
    const processExit = conn.closed.then((info) => {
      if (info.kind !== "exit") {
        return new Promise<void>(() => {});
      }
    });
    if (conn.dispatch === undefined) {
      throw new ConnectError(
        `remote padi on ${host}: the ssh link exposed no dispatch, so the frozen control core is unreachable`,
        "remote",
        true,
      );
    }
    const daemonClient = padiClientOver(conn.dispatch);
    const active = {
      client: daemonClient,
      dispose: conn.teardown,
      processExit,
      signal: ctx.signal,
    };
    const scopedClient = scopePadiSurface(daemonClient);
    combinedByScopedClient.set(scopedClient, active);
    return { ...conn, client: scopedClient };
  };

  function awaitExitViaProcessOracle(
    processExit: Promise<void>,
  ): Effect.Effect<void> {
    return Effect.promise(() => processExit);
  }

  function drainAndAwaitClose(active: ActiveCombined): Effect.Effect<
    {
      took: boolean;
      drainRejection: string | null;
    },
    Error
  > {
    return drainAndAwaitExit(
      active.client.control.surface.core.drain(),
      awaitExitViaProcessOracle(active.processExit),
      { ceilingMs: drainCeilingMs },
    );
  }

  const admitEffect = (
    scopedClient: PadiSurfaceClient,
  ): Effect.Effect<AdmitVerdict, unknown> =>
    Effect.gen(function* () {
      const active = combinedByScopedClient.get(scopedClient);
      if (active === undefined) {
        return yield* Effect.fail(
          new Error("remote padi admit: no matching combined connection"),
        );
      }
      const probe = yield* probeDaemonIdentityFrom({
        client: {
          surface: { control: active.client.control.surface },
        } as ControlCoreProbeClient,
        dispose: active.dispose,
        capability: "drainable",
        awaitExit: awaitExitViaProcessOracle(active.processExit),
        drainCeilingMs,
      });
      if (active.signal.aborted) {
        return yield* Effect.fail(new Error("remote padi admit superseded"));
      }
      const runningBuild =
        probe.identity.build.kind === "known" ? probe.identity.build.id : "";

      const generationPlugs = generationBoundAdmitDrainPlugs(active.signal, {
        drain: probe.fireDrain,
        awaitExit: probe.awaitExit,
      });
      const verdict = yield* convergeAdmit({
        running: {
          ...probe.identity,
          instanceKey: probe.instanceKey,
        },
        budget,
        drain: generationPlugs.drain,
        awaitExit: generationPlugs.awaitExit,
        ceilingMs: probe.drainCeilingMs,
        log: log.child({ host }),
      });
      if (active.signal.aborted) {
        return yield* Effect.fail(new Error("remote padi admit superseded"));
      }

      if (
        verdict.kind === "replaced" &&
        runningBuild !== "" &&
        runningBuild !== binderBuildId
      ) {
        log.info(
          { host, binderBuildId, runningBuild },
          `padi build change on boot: running=${runningBuild} expected=${binderBuildId}` +
            " — draining the survivor (persist + exit, its kaval + PTYs survive) and respawning this binder's own build (drain-on-build-mismatch, #1670)",
        );
      }

      switch (verdict.kind) {
        case "adopt": {
          convergence = null;
          activeCombined = active;
          return { kind: "adopt" };
        }
        case "adopt-stale": {
          convergence = verdict.anomaly;
          activeCombined = active;
          return { kind: "adopt" };
        }
        case "replaced": {
          convergence = null;
          return { kind: "replaced", reason: verdict.reason };
        }
        case "refuse": {
          convergence = verdict.anomaly;
          return {
            kind: "refuse",
            state: { error: verdict.error, cause: "remote" },
          };
        }
        default: {
          const _exhaustive: never = verdict;
          throw new Error(
            `remote padi admit: unreachable verdict ${JSON.stringify(_exhaustive)}`,
          );
        }
      }
    });

  const admit: Admit<PadiSurfaceClient> = (scopedClient) =>
    Effect.runPromise(admitEffect(scopedClient));

  const base: Session<PadiSurfaceClient, SshProv> = makeSession<
    PadiSurfaceClient,
    SshProv
  >({
    connectOnce: rawConnector,
    initialConnection: "probing",
    admit,
    log: log.child({ host }),
    label: `host:${host}`,
  });

  base.onState((s) => {
    if (s.phase === "failed") {
      if (!isEpochVerdict(convergence)) {
        convergence = {
          kind: "link-failed",
          detail: s.error,
        };
      }
      activeCombined = null;
    } else if (s.phase === "disconnected") {
      if (convergence === null || convergence.kind === "link-failed") {
        convergence = null;
      }
      activeCombined = null;
    }
  });

  return asPadiSession(base, {
    convergence: () => convergence,
    entryFailedDetail: () => entryCauseOf(convergence, drvFaultCause),
    renew: () =>
      Effect.gen(function* () {
        const active = activeCombined;
        if (active === null) {
          return yield* Effect.fail(
            new Error(
              "remote padi is not bound — cannot drain (the daemon is unreachable)",
            ),
          );
        }
        const { took, drainRejection } = yield* drainAndAwaitClose(active);
        if (!took) {
          return yield* Effect.fail(
            new Error(
              `remote padi drain did not complete — it did not exit within ${drainCeilingMs}ms (padi did not exit)` +
                drainRejectionSuffix(drainRejection),
            ),
          );
        }
      }),
  });
}
