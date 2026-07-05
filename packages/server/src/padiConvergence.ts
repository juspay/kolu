/**
 * padi's CONVERGENCE declaration into the shared daemon-convergence kit
 * (`@kolu/surface-daemon-supervisor`'s `converge`), plus the drain plumbing the
 * declaration and the "restart" verb both reach for.
 *
 * This is the fourth concern carved out of {@link ./padiBinding.ts} (W4 ledger L6):
 * the binder proper is the driver + the reconnect-mirror session + `ensurePadiBinding`;
 * THIS file is padi's contract-skew POLICY and the FROZEN-control-core probe/drain that
 * enact it. It varies with a DIFFERENT volatility than the binder — the daemon-lifecycle
 * skew policy — and was already deps-injected (the kit owns the mechanism, the two-axis
 * ordering, and the build fence; padi only declares its policy + adapts its hello into the
 * kit's identity probe), so it separates cleanly.
 *
 * The two-axis behaviour (contract drain-newer/refuse-older; build-mismatch drain-once,
 * #1670) lives in the kit — UNCHANGED. What this file owns:
 *   - {@link PADI_CONVERGENCE_POLICY} — padi's declared policy (drainable; drain-newer-
 *     else-refuse on contract skew; drain-and-replace on build mismatch).
 *   - {@link probePadiForConvergence} — the kit's identity probe for padi: dial the FROZEN
 *     control core, read identity, expose a `drain`.
 *   - {@link drainViaControlCore} — the ONE drain mechanism, shared by BOTH the probe's
 *     `drain` and the user-facing "restart" (`PadiBindingSession.drainBoundPadi`).
 */

import {
  dialPadiHello,
  type PadiDaemonClient,
  type PadiDial,
} from "@kolu/padi/dial";
import {
  type ConvergencePolicy,
  type ConvergenceProbe,
  daemonBuild,
} from "@kolu/surface-daemon-supervisor";

/** How long `drainViaControlCore` waits for the socket to CLOSE after the drain RPC
 *  rejects, before treating the rejection as a real failure. A drain that reached
 *  padi persists + exits near-instantly, so the close follows within a beat; this
 *  ceiling only bounds the wait for a rejection that is NOT the expected teardown
 *  (a stale link, or an `onDrain` that threw before persisting) so the "restart"
 *  verb reports failure instead of hanging. */
const DRAIN_TEARDOWN_CEILING_MS = 2000;

// padi declares its policy into the shared kit; the kit owns the mechanism + ordering +
// fence. padi is drain-capable (its control core has a `drain` verb), so it can spell the
// drain arms: a contract skew drains-if-newer / refuses-if-older, and a build mismatch
// drains-and-replaces once per binder boot.
export const PADI_CONVERGENCE_POLICY: ConvergencePolicy<"drainable"> = {
  capability: "drainable",
  onContractSkew: { kind: "drain-newer-else-refuse" },
  onBuildMismatch: { kind: "drain-and-replace" },
};

/** The minimal connection shape the drain plumbing needs: the COMBINED dialed
 *  client (to reach `surface.control.core.drain`) and an `onClose` (the socket
 *  close that is the drain's ground truth). Both a held endpoint connection
 *  (`endpoint.current()`) and a fresh convergence probe (`probePadiForConvergence`)
 *  satisfy it. */
export type DrainableConn = {
  client: PadiDaemonClient;
  onClose: (cb: () => void) => void;
};

/**
 * DRAIN a padi over the FROZEN control core, then confirm it actually exited by
 * the SOCKET CLOSING within the teardown window. The one drain mechanism, shared
 * by BOTH the user-facing "restart" (`PadiBindingSession.drainBoundPadi`) and the
 * shared kit's convergence drain (through {@link probePadiForConvergence}'s `drain`)
 * — never re-rolled.
 *
 * GROUND TRUTH is the SOCKET CLOSE (padi actually exited), NOT the drain call's
 * resolve/reject. padi's `onDrain` persists, REPLIES, then triggers the exit that
 * closes the socket — so `drain()` can RESOLVE with padi still momentarily alive
 * (a reply beats the exit), or REJECT (the reply lost as the socket died mid-write),
 * and neither is the completion signal. Waiting only for the resolve would let the
 * convergence pre-flight race `adoptOrSpawnOrRefuse` in and RE-ADOPT the still-live,
 * about-to-exit padi (its gate pid unchanged) — the bug the newer-drain arm exists
 * to avoid. So we ALWAYS wait for the socket to close (the same signal the endpoint
 * reads to flip to `degraded`), and FAIL-FAST if it does not close within the
 * teardown window (a wedged `onDrain`, or a stale link the drain never reached) —
 * so no caller reports success on a drain that did not happen, and the pre-flight
 * never spawns over a padi that did not exit.
 */
export async function drainViaControlCore(conn: DrainableConn): Promise<void> {
  // Arm the close wait BEFORE the drain, so a fast exit that closes the socket
  // before `drain()` even settles is never missed.
  let onClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    onClosed = resolve;
  });
  conn.onClose(onClosed);

  // Kick the drain. `.catch` keeps a mid-write rejection from going unhandled and
  // remembers it only to enrich a timeout failure — the call's outcome does not
  // decide completion (the socket close does).
  let drainErr: unknown;
  void conn.client.surface.control.core.drain().catch((e) => {
    drainErr = e;
  });

  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), DRAIN_TEARDOWN_CEILING_MS);
  });
  try {
    const outcome = await Promise.race([
      closed.then(() => "closed" as const),
      timedOut,
    ]);
    if (outcome === "timeout") {
      throw new Error(
        `padi drain did not complete — its socket did not close within ${DRAIN_TEARDOWN_CEILING_MS}ms (padi did not exit)` +
          (drainErr ? `; drain call rejected: ${String(drainErr)}` : ""),
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The kit's identity probe for padi: dial the running padi's FROZEN control core and
 * expose its identity + a `drain`, or `null` if none answers (a fresh boot, or padi
 * mid-teardown) — in which case the kit's `converge` simply spawns fresh. This is the
 * intended first use of the frozen control core: "a binder dials the socket, reads
 * control.hello FIRST" (controlCore.ts), then the kit decides. padi is drain-capable, so
 * this returns a `ConvergenceProbe<"drainable">`.
 */
export async function probePadiForConvergence(
  socketPath: string,
): Promise<ConvergenceProbe<"drainable"> | null> {
  let dialed: PadiDial;
  try {
    dialed = await dialPadiHello(socketPath);
  } catch {
    return null; // no live padi answering — spawn will handle it.
  }
  const { socket, client, hello } = dialed;
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    capability: "drainable",
    // Identity read over the FROZEN control-core hello (reachable at any skew, Pin 3):
    // the padiSurface contract version + padi's build knowledge (absent → the typed
    // `off-nix` DaemonBuild, never the "" sentinel).
    identity: {
      contractVersion: hello.surfaceVersion,
      build: daemonBuild(hello.buildId ?? ""),
    },
    drain: () =>
      drainViaControlCore({
        client,
        onClose: (cb) => {
          if (closed) queueMicrotask(cb);
          else socket.once("close", cb);
        },
      }),
    dispose: () => socket.destroy(),
  };
}
