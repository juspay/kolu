import {
  connectPadi,
  type PadiConnectionMetadata,
  type PadiDaemonClient,
  type PadiHelloIdentity,
} from "@kolu/padi-client/dial";
import { padiRuntimeHome } from "@kolu/padi-client/rendezvous";
import type { StdioReadinessVerdict } from "@kolu/surface/links/readiness";
import {
  type Logger,
  type ResolvedDaemonHome,
  stderrLogger,
} from "@kolu/surface-daemon";
import {
  converge,
  type ConvergenceAnomaly,
  type ConvergenceOutcome,
  type ConvergenceProbe,
  createEndpoint,
  type DaemonDriver,
  type Endpoint,
  outcomeAnomaly,
  probeDaemonIdentity,
  processStateReader,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";
import { AGENT_TOOLS_BAKE_ENV } from "kolu-pty";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import { drainResidentOnAgentToolsBakeDrift } from "../agentToolsBake.ts";
import { padiConvergencePolicy } from "../convergencePolicy.ts";
import { currentPadiBuildId } from "./buildId.ts";
import { spawnDetachedPadi } from "./detachedDaemon.ts";

const FRONT_DRAIN_TEARDOWN_CEILING_MS = 2000;

export interface ConvergeFrontOptions {
  readonly stateRoot: string;
  readonly socketOverride?: string;
}

type DaemonProbe = (
  socketPath: string,
) => Effect.Effect<ConvergenceProbe<"drainable"> | null, Error>;
type ConvergeEndpoint = Endpoint<
  PadiDaemonClient,
  PadiHelloIdentity,
  PadiConnectionMetadata
>;

function buildConvergeEndpoint(args: {
  readonly stateRoot: string;
  readonly home: ResolvedDaemonHome;
  readonly osfactsBin: string;
  readonly probe: DaemonProbe;
  readonly log: Logger;
}): ConvergeEndpoint {
  const { stateRoot, home, osfactsBin, probe, log } = args;
  const driver: DaemonDriver = {
    spawn: Effect.try({
      try: () => spawnDetachedPadi(stateRoot),
      catch: (err) => err as Error,
    }),
  };
  return createEndpoint<
    PadiDaemonClient,
    PadiHelloIdentity,
    PadiConnectionMetadata
  >({
    hostId: "padi-stdio-front",
    home,
    policy: padiConvergencePolicy(currentPadiBuildId()),
    probe,
    readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
    readSocketHolders: osfactsSocketHolders(osfactsBin),
    readProcessState: processStateReader(osfactsBin),
    driver,
    connect: (path) => connectPadi(path),
    log,
    onStatus: (_hostId, status) =>
      log.info({ state: status.state }, "padi --stdio: converge"),
  });
}

function toolchainDriftPrecheck(args: {
  readonly home: ResolvedDaemonHome;
  readonly probe: DaemonProbe;
  readonly log: Logger;
}): Effect.Effect<void, Error> {
  const { home, probe, log } = args;
  const ownBake = process.env[AGENT_TOOLS_BAKE_ENV] ?? "";
  return Effect.map(
    drainResidentOnAgentToolsBakeDrift({
      runtimeDir: home.dir,
      socketPath: home.socketPath,
      ownBake,
      ownBuildId: currentPadiBuildId(),
      probe,
    }),
    (drift) => {
      if (drift.kind === "drained") {
        log.info(
          { recorded: drift.recorded, ownBake },
          "padi --stdio: toolchain change — drained the survivor; converge respawns this closure's build (drain-on-tools-drift, #2146)",
        );
        return;
      }
      if (drift.kind === "probe-failed" || drift.kind === "drain-failed") {
        log.warn(
          { recorded: drift.recorded, ownBake, error: drift.error },
          "padi --stdio: toolchain drift detected but the drain step failed — proceeding to converge",
        );
      }
    },
  );
}

function verdictFrom(args: {
  readonly outcome: ConvergenceOutcome;
  readonly converged: boolean;
  readonly home: ResolvedDaemonHome;
  readonly anomaly: ConvergenceAnomaly | null;
  readonly log: Logger;
}): StdioReadinessVerdict {
  const { outcome, converged, home, anomaly, log } = args;
  if (outcome.kind === "refused" || !converged) {
    const detail =
      anomaly?.detail ??
      `padi at ${home.socketPath} did not converge (${outcome.kind})`;
    log.error(
      { outcome: outcome.kind, socketPath: home.socketPath, anomaly },
      "padi --stdio: refusing to relay — convergence did not settle",
    );
    return { verdict: "refused", detail, anomaly: anomaly ?? null };
  }
  log.info(
    { outcome: outcome.kind, socketPath: home.socketPath, anomaly },
    "padi --stdio: converged — relaying",
  );
  return { verdict: "ready" };
}

export function convergeStdioFront(
  opts: ConvergeFrontOptions,
): Effect.Effect<StdioReadinessVerdict, Error> {
  return Effect.gen(function* () {
    const home = padiRuntimeHome(opts.stateRoot, opts.socketOverride);
    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    const log = stderrLogger();
    const probe = probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: FRONT_DRAIN_TEARDOWN_CEILING_MS,
    });
    const endpoint = buildConvergeEndpoint({
      stateRoot: opts.stateRoot,
      home,
      osfactsBin,
      probe,
      log,
    });

    yield* toolchainDriftPrecheck({ home, probe, log });

    const outcome = yield* converge(endpoint);
    const held = endpoint.current();
    held?.dispose();
    return verdictFrom({
      outcome,
      converged: held !== undefined,
      home,
      anomaly: outcomeAnomaly(outcome),
      log,
    });
  });
}
