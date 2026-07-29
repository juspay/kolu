/**
 * padi's CONVERGENCE declaration into the shared daemon-convergence kit
 * (`@kolu/surface-daemon-supervisor`'s `converge` / `convergeAdmit`), plus the drain
 * plumbing the declaration and the "restart" verb both reach for.
 *
 * This is the fourth concern carved out of {@link ./padiBinding.ts} (W4 ledger L6):
 * the binder proper is the driver + the reconnect-mirror session + `ensurePadiBinding`;
 * THIS file is padi's contract-skew POLICY and the FROZEN-control-core probe/drain that
 * enact it.
 *
 * What this file owns:
 *   - {@link padiConvergencePolicy} — padi's declared policy (drainable; baked identity;
 *     drain-newer-else-refuse on contract skew; drain-and-replace on build mismatch;
 *     Cap-gated drainBudget). ONE object for BOTH arms.
 *   - {@link probePadiForConvergence} — the kit's identity probe for padi.
 *   - {@link drainViaControlCore} — the endpoint arm's drain, built on the framework's
 *     {@link drainAndAwaitExit}.
 *
 * Framework anomalies ride the wire AS-IS ({@link PadiConvergence} re-derives the
 * framework union shape + app-only `link-failed`). There is no converter.
 */

import {
  dialPadiHello,
  type PadiDaemonClient,
  type PadiDial,
} from "@kolu/padi/dial";
import { PADI_SURFACE_VERSION } from "@kolu/padi/surface";
import {
  type ConvergencePolicy,
  type ConvergenceProbe,
  daemonBuild,
  drainAndAwaitExit,
  drainRejectionSuffix,
  instanceKeyFromStartedAt,
} from "@kolu/surface-daemon-supervisor";

// Re-export the framework drain skeleton so the remote arm's existing import path
// (`./padiConvergence`) keeps working; the implementation lives in the supervisor.
export { drainAndAwaitExit };

/** How long `drainViaControlCore` waits for the socket to CLOSE after the drain RPC
 *  rejects, before treating the rejection as a real failure. */
const DRAIN_TEARDOWN_CEILING_MS = 2000;

/**
 * padi's full convergence policy for a given binder build id. Drainable; budget
 * survives adopts; `onGiveUp: "adopt-stale"` so a flapping link rides the resident
 * with a standing anomaly rather than going dark. Cap-gates make `drainBudget`
 * unspellable on a not-drainable policy (kaval never constructs one).
 */
export function padiConvergencePolicy(
  binderBuildId: string,
): ConvergencePolicy<"drainable"> {
  return {
    capability: "drainable",
    baked: {
      contractVersion: PADI_SURFACE_VERSION,
      build: daemonBuild(binderBuildId),
    },
    onContractSkew: { kind: "drain-newer-else-refuse" },
    onBuildMismatch: { kind: "drain-and-replace" },
    // Shared by local + ssh arms. Local used to be a once-per-boot boolean (≡ 1);
    // remote used 3. Unified at 3 so a same-instance flap still terminates, and the
    // budget's cross-supervisor memory survives adopts on both arms.
    drainBudget: { maxAttempts: 3, onGiveUp: "adopt-stale" },
  };
}

/** The minimal connection shape the drain plumbing needs. */
export type DrainableConn = {
  client: PadiDaemonClient;
  onClose: (cb: () => void) => void;
};

export { drainRejectionSuffix };

/**
 * DRAIN a padi over the FROZEN control core, then confirm it actually exited by
 * the SOCKET CLOSING within the teardown window — the endpoint/local arm's use of
 * the framework {@link drainAndAwaitExit}. THROWS when the drain does not take.
 */
export async function drainViaControlCore(conn: DrainableConn): Promise<void> {
  const { took, drainRejection } = await drainAndAwaitExit(
    () => conn.client.surface.control.core.drain(),
    // The endpoint's exit signal is the SOCKET CLOSE.
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
 * expose its identity + instance key + a `drain`, or `null` if none answers.
 */
/** True when the dial failure means "nothing listening" (honest null probe). */
function isNoListenerError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.code ?? e.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOENT";
}

/**
 * Probe a running padi. Returns `null` only for no-listener (ECONNREFUSED /
 * ENOENT). Any other dial/handshake failure **throws** (F2) — never collapses
 * into "no daemon" so a mismatched survivor is not silently adopted.
 */
export async function probePadiForConvergence(
  socketPath: string,
): Promise<ConvergenceProbe<"drainable"> | null> {
  let dialed: PadiDial;
  try {
    dialed = await dialPadiHello(socketPath);
  } catch (err) {
    if (isNoListenerError(err)) return null;
    throw err; // F2: typed failure — converge must not treat as empty socket
  }
  const { socket, client, hello } = dialed;
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    capability: "drainable",
    identity: {
      contractVersion: hello.surfaceVersion,
      build: daemonBuild(hello.buildId ?? ""),
    },
    // Absent startedAt → pre-instance (older daemon), never overloaded null.
    instanceKey: instanceKeyFromStartedAt(hello.startedAt),
    // Plugs only — the framework runs drainAndAwaitExit (same as convergeAdmit).
    fireDrain: () => client.surface.control.core.drain(),
    awaitExit: (signal) =>
      new Promise<void>((resolve) => {
        if (closed) {
          queueMicrotask(resolve);
          return;
        }
        const onClose = () => resolve();
        socket.once("close", onClose);
        signal.addEventListener(
          "abort",
          () => {
            socket.off("close", onClose);
            resolve();
          },
          { once: true },
        );
      }),
    drainCeilingMs: DRAIN_TEARDOWN_CEILING_MS,
    dispose: () => socket.destroy(),
  };
}
