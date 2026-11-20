import { readControlCoreHello } from "@kolu/surface-daemon-supervisor";
import { processStateReader } from "@kolu/surface-daemon-supervisor";
import type { DaemonConnection } from "@kolu/surface-daemon-supervisor";
import {
  type ControlCoreProbeClient,
  converge,
  createEndpoint,
  type DaemonDriver,
  dialSocket,
  outcomeAnomaly,
  probeDaemonIdentity,
} from "@kolu/surface-daemon-supervisor";
import {
  type DaemonHomePaths,
  reExecAsDetachedDaemon,
  stderrLogger,
} from "@kolu/surface-daemon";
import { buildSurfaceFace } from "@kolu/surface/client";
import { socketDuplexLink } from "@kolu/surface/links/stdio";
import type { StdioReadinessVerdict } from "@kolu/surface/links/readiness";
import { Effect } from "effect";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import { kavalConvergencePolicy } from "./convergencePolicy.ts";
import { kavalControlSurface } from "./daemonSurface.ts";
import type { PtyHostIdentity } from "./ptyHostSurface.ts";

type FrontIdentity = PtyHostIdentity;

function dialFrozenControlCoreOnly(
  socketPath: string,
): Effect.Effect<
  DaemonConnection<ControlCoreProbeClient, FrontIdentity>,
  Error
> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);
    const link = yield* Effect.promise(() =>
      socketDuplexLink({
        group: kavalControlSurface.group,
        socket,
        describe: `unix socket ${socketPath}`,
      }),
    );
    const core = buildSurfaceFace(kavalControlSurface, link.dispatch).surface
      .core as unknown as ControlCoreProbeClient["surface"]["control"]["core"];
    const client: ControlCoreProbeClient = {
      surface: { control: { core } },
    };
    let teardown: Promise<void> | undefined;
    const dispose = (): Promise<void> =>
      (teardown ??= (async () => {
        await link.dispose();
        socket.destroy();
      })());
    // `onError`, not `catch`: in Effect an interruption is not a failure, so a
    // `catch*` would not run and the link would leak on the abandoned dial.
    const hello = yield* Effect.onError(readControlCoreHello(client), () =>
      Effect.promise(dispose),
    );
    let closed = false;
    socket.once("close", () => {
      closed = true;
    });
    return {
      client,
      identity: {
        staleKey: hello.buildId ?? "",
        navigableCommit: hello.commit ?? "",
      },
      startedAt: hello.startedAt,
      metadata: undefined,
      dispose: () => {
        void dispose().catch((err: unknown) => {
          stderrLogger().warn(
            { socketPath, err: String(err) },
            "kaval control-core dispose failed",
          );
        });
      },
      onClose: (cb) => {
        if (closed) queueMicrotask(cb);
        else socket.once("close", cb);
      },
    };
  });
}

export interface ConvergeKavalFrontOptions {
  readonly home: DaemonHomePaths;
  readonly stderrLog: string;
}

export function convergeKavalStdioFront(
  opts: ConvergeKavalFrontOptions,
): Effect.Effect<StdioReadinessVerdict, Error> {
  return Effect.gen(function* () {
    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    const log = stderrLogger();
    const driver: DaemonDriver = {
      spawn: Effect.try({
        try: () =>
          reExecAsDetachedDaemon({
            stripArgs: ["--stdio"],
            stderrLog: opts.stderrLog,
          }),
        catch: (err) => err as Error,
      }),
    };
    const endpoint = createEndpoint<
      ControlCoreProbeClient,
      FrontIdentity,
      undefined
    >({
      hostId: "kaval-stdio-front",
      home: opts.home,
      policy: kavalConvergencePolicy(),
      probe: probeDaemonIdentity({ capability: "not-drainable" }),
      readProcessIdentity: (pid) => processIdentityAsync(osfactsBin, pid),
      readSocketHolders: osfactsSocketHolders(osfactsBin),
      readProcessState: processStateReader(osfactsBin),
      driver,
      connect: (path) => dialFrozenControlCoreOnly(path),
      log,
      onStatus: (_hostId, status) =>
        log.info({ state: status.state }, "kaval --stdio: converge"),
    });

    const outcome = yield* converge(endpoint);
    const anomaly = outcomeAnomaly(outcome);
    const held = endpoint.current();
    held?.dispose();

    if (outcome.kind === "refused" || held === undefined) {
      const detail =
        anomaly?.detail ??
        `kaval at ${opts.home.socketPath} did not converge (${outcome.kind})`;
      log.error(
        { outcome: outcome.kind, socketPath: opts.home.socketPath, anomaly },
        "kaval --stdio: refusing to relay — convergence did not settle",
      );
      return { verdict: "refused", detail, anomaly: anomaly ?? null };
    }
    log.info(
      { outcome: outcome.kind, socketPath: opts.home.socketPath },
      "kaval --stdio: converged — relaying",
    );
    return { verdict: "ready" };
  });
}
