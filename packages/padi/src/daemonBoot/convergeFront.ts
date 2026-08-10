/**
 * The `padi --stdio` front's **converge-before-relay** pre-step (juspay/kolu#2101).
 *
 * ## The parity hole this closes
 *
 * kolu's LOCAL arm has run the full daemon-convergence kit since W4: probe the
 * resident over a throwaway raw socket with a byte tap, classify an
 * `unspeakable-protocol` peer (undecodable first frame, or 8s of silence — what a
 * previous-epoch daemon looks like), corroborate it against the gate file and the
 * pid table, and TAKE IT OVER. The REMOTE arm had none of it: `padi --stdio`
 * spliced its stdio into any socket that accepted, and the ssh client's RPC pinger
 * discovered the truth ~10s later as a nondescript transport death.
 *
 * The fix is not to teach the generic relay about convergence — `frontDaemonOverStdio`
 * is contract-blind by contract, and that blindness is what makes the byte splice
 * legal. It is to run the SAME convergence the local arm runs, in the owning binary,
 * BEFORE the relay engages. And the remote box is exactly where it belongs: the
 * gate file, the pid table and the signals all live there. kolu-server, an ssh hop
 * away, can read none of them.
 *
 * ## What the front converges with
 *
 * The full kit — nothing stubbed, because a stubbed probe is how the hole reopens:
 *
 *   - **probe** = the `probeDaemonIdentity` FACTORY (not the assembly-only
 *     `…From` variant the ssh admit hook uses): the raw dial with the byte tap and
 *     the silence deadline, which is the only thing that can SEE a previous-epoch
 *     peer at all;
 *   - **policy** = `@kolu/padi/convergence-policy`, the same object kolu-server's
 *     binder builds — one declaration, two supervisors, no drift;
 *   - **OS facts** = `osfacts`, baked into the padi wrapper, so gate corroboration
 *     and gate-less-squatter recovery work here exactly as locally;
 *   - **driver** = the front's own `reExecAsDetachedDaemon` thunk, so a takeover
 *     replaces the resident with a daemon of THIS closure;
 *   - **connect** = padi's own `connectPadi` dial.
 *
 * ## The verdict is a banner, not an exception
 *
 * A converged front greets `ready` and relays. A front that could not converge
 * writes a `refused` banner carrying the typed anomaly and exits non-zero WITHOUT
 * relaying — so the ssh client learns "this host's padi speaks a previous protocol
 * epoch" as a fact it can render, instead of inferring a down host from a ping
 * timeout. Fail-fast, and loudly: there is no arm here that relays anyway.
 *
 * Double convergence with kolu-server's own `convergeAdmit` is deliberate and
 * harmless: after this front converges, the binder's admit meets a daemon of its
 * own epoch and simply adopts. The admit stays the in-epoch authority for the
 * durable session (generation fencing, contract skew), which this pre-step does
 * not and should not replace.
 *
 * Two kolu servers binding one host converge two fronts concurrently — which is
 * precisely what the instanceKey / cross-supervisor machinery already adjudicates.
 * No extra locking is invented here.
 */

import {
  type PadiConnectionMetadata,
  type PadiDaemonClient,
  type PadiHelloIdentity,
  connectPadi,
} from "../dial.ts";
import { reExecAsDetachedDaemon, stderrLogger } from "@kolu/surface-daemon";
import {
  converge,
  createEndpoint,
  type DaemonDriver,
  outcomeAnomaly,
  probeDaemonIdentity,
} from "@kolu/surface-daemon-supervisor";
import type { StdioReadinessVerdict } from "@kolu/surface/links/readiness";
import { Effect } from "effect";
import { AGENT_TOOLS_BAKE_ENV } from "kolu-pty";
import {
  bakedOsFactsBin,
  osfactsSocketHolders,
  processIdentityAsync,
} from "osfacts-client";
import { drainResidentOnAgentToolsBakeDrift } from "../agentToolsBake.ts";
import { padiConvergencePolicy } from "../convergencePolicy.ts";
import { padiRuntimeHome, padiStderrLogPath } from "../stateRoot.ts";
import { currentPadiBuildId } from "./buildId.ts";

/** How long the front's own drain waits for a survivor's socket to close after
 *  the drain RPC returns, before calling the drain not-taken. The same ceiling
 *  kolu-server's endpoint arm uses — same daemon, same teardown. */
const FRONT_DRAIN_TEARDOWN_CEILING_MS = 2000;

export interface ConvergeFrontOptions {
  /** The already-resolved state root — the front's identity. */
  readonly stateRoot: string;
  /** The `--socket` override, if the CLI carried one. */
  readonly socketOverride?: string;
}

/**
 * Converge the durable padi this front is about to relay to, and answer with the
 * banner the front should write.
 *
 * `ready` means a daemon of THIS epoch and contract now holds the rendezvous —
 * adopted, recycled, or taken over from a previous-epoch resident. Anything else
 * is `refused`, carrying the framework's typed `ConvergenceAnomaly` verbatim as
 * the banner's opaque payload: the anomaly union and kolu-server's
 * `PadiConvergenceSchema` are the same shape by construction (the schema
 * re-derives it), so the binder decodes it directly with no converter between.
 *
 * The endpoint's converge connection is DISPOSED before returning: it did its job
 * (proving identity), and leaving it open would hand the relay a socket the front
 * does not own. `frontDaemonOverStdio` then makes its own connection to the
 * daemon this step just settled — the adopt-or-spawn it already performs, now
 * guaranteed to meet a converged peer.
 *
 * The home resolution is the front's OWN (`padiRuntimeHome(stateRoot, override)`)
 * and deliberately does NOT consult `residentPadiSocket`'s cross-drawer
 * discovery: `reExecAsDetachedDaemon` re-execs this argv, so the daemon binds the
 * path this same formula yields. Converging against a socket in a drawer the
 * re-exec would not bind is how a front and its own daemon end up at two
 * rendezvous.
 */
export function convergeStdioFront(
  opts: ConvergeFrontOptions,
): Effect.Effect<StdioReadinessVerdict, Error> {
  return Effect.gen(function* () {
    const { stateRoot } = opts;
    const home = padiRuntimeHome(stateRoot, opts.socketOverride);
    // ONE axis — where this program's osfacts binary lives — resolved ONCE and
    // bound to BOTH OS-fact injects, exactly as the local arms do it. A missing
    // bake is a loud failure here rather than a surprise mid-takeover.
    const osfactsBin = bakedOsFactsBin("KOLU_OSFACTS_BIN");
    // stderr, never stdout: stdout is the wire, and the banner must be the first
    // thing to land on it.
    const log = stderrLogger();
    const driver: DaemonDriver = {
      // The front's own spawn, lifted. `reExecAsDetachedDaemon` re-execs THIS
      // binary minus `--stdio`, so a takeover's replacement is a padi of this
      // closure serving this same state-root — the property the pre-step rests on.
      spawn: Effect.try({
        try: () =>
          reExecAsDetachedDaemon({
            stripArgs: ["--stdio"],
            stderrLog: padiStderrLogPath(stateRoot),
          }),
        catch: (err) => err as Error,
      }),
    };

    // Hoisted so the #2146 toolchain-drift pre-check below and the endpoint
    // share ONE probe value — two probeDaemonIdentity calls with the same args
    // is how the two dials drift apart.
    const probe = probeDaemonIdentity({
      capability: "drainable",
      drainCeilingMs: FRONT_DRAIN_TEARDOWN_CEILING_MS,
    });

    const endpoint = createEndpoint<
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
      driver,
      connect: (path) => connectPadi(path),
      log,
      // The front holds no reactive status — it converges once and then either
      // relays or exits, so every transition is already covered by the outcome
      // this function returns. Logging each one to stderr keeps the takeover
      // legible in `padi.stderr.log` without inventing a second channel.
      onStatus: (_hostId, status) =>
        log.info({ state: status.state }, "padi --stdio: converge"),
    });

    // ── Toolchain-drift pre-check (juspay/kolu#2146) ────────────────────────
    // The remote-host twin of kolu-server's binder pre-check: this front runs
    // from the freshly provisioned closure, so its own bake IS the toolchain a
    // current daemon would hand terminals. A resident whose record names a
    // different one survived a provision that changed only the client CLIs —
    // invisible to the build axis — and must be drained (persist + exit; kaval
    // + PTYs survive) so the converge below respawns it from THIS closure.
    // Same-machine comparison by construction: front and resident share a host.
    const ownBake = process.env[AGENT_TOOLS_BAKE_ENV] ?? "";
    const drift = yield* drainResidentOnAgentToolsBakeDrift({
      runtimeDir: home.dir,
      socketPath: home.socketPath,
      ownBake,
      // Same-build residents only — a foreign build is the kit's own axis.
      ownBuildId: currentPadiBuildId(),
      probe,
    });
    if (drift.kind === "drained") {
      log.info(
        { recorded: drift.recorded, ownBake },
        "padi --stdio: toolchain change — drained the survivor; converge respawns this closure's build (drain-on-tools-drift, #2146)",
      );
    } else if (drift.kind === "probe-failed" || drift.kind === "drain-failed") {
      // Loud, then fail open into converge — the kit's probe/classify machinery
      // owns unreachable/undrainable residents.
      log.warn(
        { recorded: drift.recorded, ownBake, error: drift.error },
        "padi --stdio: toolchain drift detected but the drain step failed — proceeding to converge",
      );
    }

    const outcome = yield* converge(endpoint);
    const anomaly = outcomeAnomaly(outcome);
    const held = endpoint.current();
    // Release the converge connection whatever the verdict: on `ready` the relay
    // dials its own, and on `refused` nothing will use it at all.
    held?.dispose();

    if (outcome.kind === "refused" || held === undefined) {
      // No daemon of this epoch holds the rendezvous. `anomaly` is the framework's
      // typed reason — including the `unconverged` / `unspeakable-protocol` arm
      // for the one residual a takeover cannot act on (the gate stopped naming the
      // classified pid between the observation and the kill).
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
  });
}
