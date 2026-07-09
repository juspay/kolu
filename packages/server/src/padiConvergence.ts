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
 *   - {@link drainAndAwaitExit} — the ONE drain-and-confirm-exit skeleton, shared by
 *     BOTH bound-padi arms (this file's endpoint {@link drainViaControlCore} and the
 *     remote ssh arm's hello-poll); the transport's exit signal is the only variable.
 *   - {@link drainViaControlCore} — the endpoint arm's use of that skeleton, shared by
 *     BOTH the probe's `drain` and the user-facing "restart" (the local padi session's
 *     `renew()`, added to the base session by spread in `padiBinding.ts`).
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
 * The SHARED drain-and-confirm-exit skeleton, transport-agnostic. Arm the exit
 * signal, fire the FROZEN-control-core drain fire-and-forget (remembering a
 * rejection only to enrich a not-taken outcome), then race the exit against a
 * ceiling. Both arms of a bound padi reach for this: the LOCAL/endpoint arm's
 * socket-close (via {@link drainViaControlCore}) and the REMOTE ssh arm's
 * hello-poll — they differ ONLY in the `awaitExit` plug and in what a not-taken
 * outcome MEANS (a throw vs a boolean), which stays with the caller.
 *
 * GROUND TRUTH is the EXIT (padi actually gone), NOT the drain call's
 * resolve/reject. padi's `onDrain` persists, REPLIES, then triggers the exit — so
 * `drain()` can RESOLVE with padi still momentarily alive (a reply beats the
 * exit), or REJECT (the reply lost as the link died mid-write), and neither is the
 * completion signal. Waiting only for the resolve would let a convergence
 * pre-flight RE-ADOPT the still-live, about-to-exit padi — the bug the newer-drain
 * arm exists to avoid. So we ALWAYS wait for the transport's exit signal, bounded
 * by the ceiling.
 *
 * `awaitExit` is armed BEFORE the drain is fired, so a fast exit that fires before
 * `drain()` even settles is never missed. It resolves when the exit is observed and
 * MUST NOT reject — it observes its own {@link AbortSignal} (aborted the instant the
 * ceiling wins) to stop cleanly, so a poll-based plug never leaks a probe every tick
 * after the primitive returns.
 *
 * @returns `took: true` when the exit was observed within `ceilingMs` (the drain
 * took), `false` when the ceiling won first (the daemon kept answering).
 * `drainRejection` carries a mid-write `drain()` rejection, if any, for the caller
 * to fold into its not-taken message.
 */
/** The shared "; drain call rejected: …" tail for a drain-did-not-take error — folds
 *  a mid-write `drain()` rejection into the message, or "" when the call resolved but
 *  the daemon kept answering. Keeps all four drain-timeout messages byte-identical. */
export function drainRejectionSuffix(rejection: string | null): string {
  return rejection ? `; drain call rejected: ${rejection}` : "";
}

export async function drainAndAwaitExit(
  drainClient: PadiDaemonClient,
  awaitExit: (signal: AbortSignal) => Promise<void>,
  { ceilingMs }: { ceilingMs: number },
): Promise<{ took: boolean; drainRejection: string | null }> {
  // Arm the exit wait BEFORE the drain, so a fast exit is never missed. The abort
  // lets a poll-based `awaitExit` stop the moment the ceiling wins.
  const abort = new AbortController();
  const exited = awaitExit(abort.signal);
  exited.catch(() => {}); // defensive: a mis-behaving plug must not crash the process

  // Kick the drain. `.catch` keeps a mid-write rejection from going unhandled and
  // remembers it only to enrich a not-taken outcome — the call's outcome does not
  // decide completion (the exit signal does).
  let drainRejection: string | null = null;
  void drainClient.surface.control.core.drain().catch((e) => {
    drainRejection = String(e);
  });

  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ceilingMs);
  });
  try {
    const outcome = await Promise.race([
      exited.then(() => "exited" as const),
      timedOut,
    ]);
    return { took: outcome === "exited", drainRejection };
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

/**
 * DRAIN a padi over the FROZEN control core, then confirm it actually exited by
 * the SOCKET CLOSING within the teardown window — the endpoint/local arm's use of
 * the shared {@link drainAndAwaitExit} skeleton, shared by BOTH the user-facing
 * "restart" (`PadiBindingSession.drainBoundPadi`) and the kit's convergence drain
 * (through {@link probePadiForConvergence}'s `drain`). THROWS when the drain does
 * not take — its renew/probe callers want a failure, never a silent no-op — so no
 * caller reports success on a drain that did not happen.
 */
export async function drainViaControlCore(conn: DrainableConn): Promise<void> {
  const { took, drainRejection } = await drainAndAwaitExit(
    conn.client,
    // The endpoint's exit signal is the SOCKET CLOSE (the same signal the endpoint
    // reads to flip to `degraded`). It fires once; there is no poll to abort.
    () => new Promise<void>((resolve) => conn.onClose(resolve)),
    { ceilingMs: DRAIN_TEARDOWN_CEILING_MS },
  );
  if (!took) {
    throw new Error(
      `padi drain did not complete — its socket did not close within ${DRAIN_TEARDOWN_CEILING_MS}ms (padi did not exit)` +
        drainRejectionSuffix(drainRejection),
    );
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
