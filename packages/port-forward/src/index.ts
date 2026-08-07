/**
 * `@kolu/port-forward` — make a port answer where your browser can reach it.
 *
 * A dev server an agent just started is typically bound to `127.0.0.1` on some
 * machine that is not the one you are looking at. This library opens a door for
 * it on the network side of THIS machine and keeps a map of those doors:
 * `(host, remotePort) → local listener`, N hosts × N ports.
 *
 *     const forwards = createForwardManager({
 *       onLost: ({ forward, reason }) => log(`${forward.key} died: ${reason}`),
 *     });
 *     const f = await forwards.create({ kind: "remote", host: "pu-dev", port: 5173 });
 *     // → http://<this machine>:${f.localPort} now serves pu-dev's 127.0.0.1:5173
 *     await forwards.cancel(f.key);
 *
 * Remote targets ride an `ssh -L` tunnel on a connection of their OWN, so a
 * forward lives exactly as long as the process that opened it — see
 * `sshForward.ts` for why. Local targets need no ssh at all: they get a plain
 * TCP relay.
 *
 * A forward listener is unauthenticated raw TCP on this machine's interfaces —
 * exactly the exposure of having run the dev server on `0.0.0.0` yourself. The
 * trust boundary is the network the machine is on.
 *
 * The package has no runtime npm dependencies (node builtins only), but a
 * remote forward spawns `ssh`, so a consumer's packaging must put OpenSSH on
 * PATH. It is the shared capability under kolu's Inspector (the Atlas note's
 * PRT2), and any future consumer should not have to drag kolu's world in to use
 * it.
 */

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
