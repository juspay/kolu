/**
 * The `kaval --stdio` front's **converge-before-relay** pre-step — the twin of
 * padi's (`@kolu/padi`'s `daemonBoot/convergeFront.ts`), and the same fix for the
 * same class (juspay/kolu#2101).
 *
 * ## Why kaval needs it even though the incident was padi's
 *
 * `kaval --stdio` is reached only by the one-shot `kaval-tui --host`, so a stale
 * daemon there is a bounded failure rather than the durable binder's infinite
 * loop. It is nonetheless mandatory, for a reason the bounded-ness does not
 * excuse: **the readiness banner must not lie.** The front process is always of
 * the CURRENT epoch — it is the closure ssh just provisioned — so a front that
 * greeted `ready` and then spliced into a previous-epoch daemon would hand the
 * client a proof that is false. A gate whose proof can be false is worse than no
 * gate, because everything downstream now trusts it.
 *
 * So the banner means what it says on both fronts: *a daemon of this epoch holds
 * this rendezvous*, established the only way it can be — by converging first.
 *
 * ## The kit, and the one thing it does NOT reuse
 *
 * Policy (`kavalConvergencePolicy`), probe (the `probeDaemonIdentity` FACTORY —
 * byte tap plus silence deadline, the only thing that can see a previous-epoch
 * peer) and driver (this binary re-exec'd minus `--stdio`) are the same values
 * padi's `ensureLocalEndpoint` supervises kaval with.
 *
 * `connect` is NOT padi's `connectKaval`, and deliberately: that dial builds the
 * full pty-host face and runs the versioned `system.version` handshake, which the
 * supervisor needs because it goes on to USE the daemon. This front does not — it
 * relays raw bytes and never speaks the contract itself. So it dials the FROZEN
 * control core only, which is the version-agnostic channel the convergence kit
 * actually reads identity from. Reaching for padi's dial would invert the
 * dependency arrow (padi → kaval is the only legal direction) to obtain a face
 * this file would immediately discard.
 */

import { readControlCoreHello } from "@kolu/surface-daemon-supervisor";
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

/** What the front's own dial reports as "identity" — the frozen control core's
 *  answer, which is all the convergence kit reads. */
type FrontIdentity = PtyHostIdentity;

/** Dial the frozen control core at `socketPath` and hand the kit a connection.
 *  No versioned handshake: this front never speaks the pty-host contract (see
 *  the module doc), so demanding it would refuse daemons the relay could serve. */
function connectControlCore(
  socketPath: string,
): Effect.Effect<DaemonConnection<ControlCoreProbeClient, FrontIdentity>, Error> {
  return Effect.gen(function* () {
    const socket = yield* dialSocket(socketPath);
    // The socket is BOTH halves so its `close` stays observable to `onClose` —
    // the local-rendezvous residual `socketDuplexLink` documents.
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
    const dispose = async (): Promise<void> => {
      await link.dispose();
      socket.destroy();
    };
    // `onError`, not `catch`: an INTERRUPTED dial releases the link too, or the
    // protocol fibers leak on the abandonment path.
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
        void dispose().catch(() => {
          /* best-effort — a link already disposed is fine */
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
  /** The home the front resolved — gate and socket co-located, never a loose
   *  path pair. The SAME home `frontDaemonOverStdio` will relay to. */
  readonly home: DaemonHomePaths;
  /** The detached daemon's stderr sink, so a takeover's replacement still leaves
   *  a readable trail instead of `/dev/null`. */
  readonly stderrLog: string;
}

/**
 * Converge the durable kaval this front is about to relay to, and answer with
 * the banner the front should write. `ready` iff a kaval of this epoch and
 * contract now holds the rendezvous; otherwise `refused`, carrying the
 * framework's typed anomaly verbatim as the opaque payload.
 */
export function convergeKavalStdioFront(
  opts: ConvergeKavalFrontOptions,
): Effect.Effect<StdioReadinessVerdict, Error> {
  return Effect.gen(function* () {
    // ONE axis — this program's osfacts binary — resolved once and bound to BOTH
    // OS-fact injects, so a missing bake is a loud failure rather than a surprise
    // mid-recovery.
    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    // stderr, never stdout: stdout is the wire.
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
      driver,
      connect: (path) => connectControlCore(path),
      log,
      onStatus: (_hostId, status) =>
        log.info({ state: status.state }, "kaval --stdio: converge"),
    });

    const outcome = yield* converge(endpoint);
    const anomaly = outcomeAnomaly(outcome);
    const held = endpoint.current();
    // Release the converge connection whatever the verdict: on `ready` the relay
    // dials its own, and on `refused` nothing will use it.
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
