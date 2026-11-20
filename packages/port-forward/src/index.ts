import type { ForwardLoss, ForwardManager } from "./manager.ts";
import { makeForwardManager } from "./manager.ts";
import { nativeMechanisms } from "./nativeMechanisms.ts";

export type { Forward, ForwardLoss, ForwardManager } from "./manager.ts";
export type { ForwardTarget, LoopbackFamily } from "./target.ts";
export {
  ASSUMED_LOOPBACK,
  formatTarget,
  LOOPBACK_ADDRESS,
  parseTarget,
  targetKey,
} from "./target.ts";

/** The map over INJECTED mechanisms, and the contract they satisfy — the seam a
 *  consumer drives its own tests through, exactly as this package's do.
 *
 *  Published because a consumer's POLICY over the map (kolu's auto-vs-manual
 *  death rule, its "only a real observation may close a door" rule) has to be
 *  tested against the REAL map: a hand-written fake manager would have to
 *  re-implement idempotence-by-target and cancel-rejects-unknown, and a policy
 *  test resting on a re-implementation of the thing it sits on is testing the
 *  fake. `createForwardManager` above stays the production entry point — this one
 *  opens nothing by itself. */
export { makeForwardManager } from "./manager.ts";
export type {
  ForwardMechanisms,
  ForwardReport,
  OpenedForward,
  OpenRequest,
} from "./mechanism.ts";

/** Open a forward map backed by the real mechanisms — ssh for remote targets,
 *  a TCP relay for local ones.
 *
 *  `onLost` is required, not optional: a forward CAN die without being
 *  cancelled (the host drops, the master goes away), and a caller with no
 *  answer for that would render forwards that no longer exist. */
export function createForwardManager<M = undefined>(opts: {
  onLost: (loss: ForwardLoss<M>) => void;
}): ForwardManager<M> {
  return makeForwardManager<M>({
    mechanisms: nativeMechanisms(),
    onLost: opts.onLost,
  });
}
