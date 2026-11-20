import {
  MAX_BUILD_DRAINS_PER_INSTANCE,
  padiConvergencePolicy,
  padiConvergencePolicyForBinding,
} from "@kolu/padi/convergence-policy";
import type { PadiDaemonClient } from "@kolu/padi-client/dial";
import {
  drainAndAwaitExit,
  drainRejectionSuffix,
} from "@kolu/surface-daemon-supervisor";
import { Effect } from "effect";

export {
  drainAndAwaitExit,
  MAX_BUILD_DRAINS_PER_INSTANCE,
  padiConvergencePolicy,
  padiConvergencePolicyForBinding,
};

export const PADI_DRAIN_TEARDOWN_CEILING_MS = 2000;

export type DrainableConn = {
  client: PadiDaemonClient;
  onClose: (cb: () => void) => void;
};

export { drainRejectionSuffix };

function awaitSocketClose(conn: DrainableConn): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    conn.onClose(() => resume(Effect.void));
  });
}

export function drainViaControlCore(
  conn: DrainableConn,
): Effect.Effect<void, Error> {
  return Effect.flatMap(
    drainAndAwaitExit(
      conn.client.control.surface.core.drain(),
      awaitSocketClose(conn),
      { ceilingMs: PADI_DRAIN_TEARDOWN_CEILING_MS },
    ),
    ({ took, drainRejection }) =>
      took
        ? Effect.void
        : Effect.fail(
            new Error(
              `padi drain did not complete — its socket did not close within ${PADI_DRAIN_TEARDOWN_CEILING_MS}ms (padi did not exit)` +
                drainRejectionSuffix(drainRejection),
            ),
          ),
  );
}
