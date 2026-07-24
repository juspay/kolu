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
 * Remote targets ride an `ssh -L` tunnel on a ControlMaster that is SHARED with
 * anything else on this machine using kolu's control path — so a forward next
 * to a running kolu adds no second ssh connection. Local targets need no ssh at
 * all: they get a plain TCP relay.
 *
 * A forward listener is unauthenticated raw TCP on this machine's interfaces —
 * exactly the exposure of having run the dev server on `0.0.0.0` yourself. The
 * trust boundary is the network the machine is on.
 *
 * The package has no dependencies at all (node builtins only): it is the shared
 * capability under kolu's Inspector and the standalone `vazhi` TUI, and neither
 * app should have to drag the other's world in to use it.
 */

import { makeForwardManager } from "./manager.ts";
import { nativeMechanisms } from "./mechanisms.ts";
import type { ForwardLoss, ForwardManager } from "./manager.ts";

export type { Forward, ForwardLoss, ForwardManager } from "./manager.ts";
export type { ForwardTarget } from "./target.ts";
export { formatTarget, parseTarget, targetKey } from "./target.ts";

/** Open a forward map backed by the real mechanisms — ssh for remote targets,
 *  a TCP relay for local ones.
 *
 *  `onLost` is required, not optional: a forward CAN die without being
 *  cancelled (the host drops, the master goes away), and a caller with no
 *  answer for that would render forwards that no longer exist. */
export function createForwardManager(opts: {
  onLost: (loss: ForwardLoss) => void;
}): ForwardManager {
  return makeForwardManager({
    mechanisms: nativeMechanisms(),
    onLost: opts.onLost,
  });
}
