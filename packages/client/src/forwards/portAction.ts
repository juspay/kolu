/**
 * What clicking a port should DO, and what a row that cannot be clicked SAYS.
 *
 * A pure join and its copy tables — no component, no DOM. It lives beside the
 * other pure joins of this feature (`portRows`, `portUrl`, `terminalServingPort`)
 * rather than inside the section that renders it, so the decision is testable on
 * its own and a render site is a READER of it rather than a second author.
 */

import { type PortReach, portReach } from "kolu-common/surface";
import { match } from "ts-pattern";
import type { PortRow } from "./portRows";

/** The words for each reason a chip is not open-as-is — a table over `PortReach`'s
 *  `via` union, so a new mechanism is a COMPILE ERROR here rather than a silently
 *  missing sentence. The decision itself is `portReach` in the vocabulary; this
 *  file owns only how it reads. */
export const FORWARD_REASON: Record<
  Extract<PortReach, { kind: "needs-forward" }>["via"],
  string
> = {
  "remote-host": "on a remote host — opens through a forward",
  loopback: "bound to loopback — opens through a forward",
};

/** …and the same for the arm no mechanism serves. Kept apart from the table above
 *  because these are not "click to forward" rows: there is nothing to offer, so
 *  the sentence has to stand on its own rather than promise an action. */
export const NO_MECHANISM_REASON: Record<
  Extract<PortReach, { kind: "no-mechanism" }>["via"],
  string
> = {
  // Not "of a remote host": the judge says the same thing about a bind on the
  // kolu server's own host, because the address it is bound to is not
  // necessarily the one in the viewer's address bar.
  "interface-bind": "bound to one interface — no forward can reach it",
};

/** Why a port is not open as-is, or `undefined` when it is. Exhaustive, so a new
 *  `PortReach` arm is a compile error rather than a silently missing sentence —
 *  which is what the two tables above are FOR, and what a render site reaching
 *  into them through a cast quietly gave up. */
export function reachReason(reach: PortReach): string | undefined {
  return match(reach)
    .with({ kind: "direct" }, () => undefined)
    .with({ kind: "needs-forward" }, ({ via }) => FORWARD_REASON[via])
    .with({ kind: "no-mechanism" }, ({ via }) => NO_MECHANISM_REASON[via])
    .exhaustive();
}

/** What clicking a chip should DO — the join of "is this port reachable as-is?"
 *  (`portReach`, which knows nothing about the viewer) with "is the viewer
 *  sitting at the machine this port is on?".
 *
 *  The second half exists because a host in kolu's fleet can be the machine you
 *  are reading kolu FROM. Without it, a port on that machine offered a forward:
 *  a door on the kolu SERVER so that your browser could reach a port on the
 *  machine you are already sitting at — a round trip through a third box to
 *  arrive where you started. It worked, and it was baffling.
 *
 *  Pure and total, so the whole decision is testable without a socket, and so
 *  that the render site is a reader of it rather than a second copy:
 *
 *   - `here`     — open `<the page's own host>:<port>`. The port answers on the
 *                  machine serving this page.
 *   - `viewer`   — open `localhost:<port>`. The port is on the machine the
 *                  browser is running on, so the browser's OWN loopback reaches
 *                  it and no door is needed or possible.
 *   - `forward`  — open a door first.
 *   - `none`     — nothing reaches it; say so. */
export type PortAction =
  | { kind: "here" }
  | { kind: "viewer" }
  | { kind: "forward" }
  | { kind: "none" };

export function portAction(opts: {
  reach: PortReach;
  /** Is the port's host the machine this browser is running on? */
  viewerOnHost: boolean;
}): PortAction {
  // The viewer arm wins over `needs-forward`, and ONLY over it — which is what
  // this now says, having previously said "not `direct`" and so caught
  // `no-mechanism` too.
  //
  // `direct` is excluded because the port already answers on the page's own
  // host: a link the user can paste elsewhere, where `localhost` is the one
  // hostname that means something different on every machine — the trap this
  // whole feature was built to avoid.
  //
  // `no-mechanism` is excluded for a harder reason. An interface-bound listener
  // is bound to ONE address, so `localhost` does not reach it even from that
  // machine, and `scope: "interface"` records that the bind is interface-specific
  // WITHOUT recording which address — so there is no URL kolu can honestly build.
  // "Not reachable" is the true answer for the viewer too.
  if (opts.viewerOnHost && opts.reach.kind === "needs-forward") {
    return { kind: "viewer" };
  }
  if (opts.reach.kind === "direct") return { kind: "here" };
  if (opts.reach.kind === "needs-forward") return { kind: "forward" };
  return { kind: "none" };
}

/** The action for one ROW of the ports list, and the sentence that goes with it.
 *
 *  An ORPHAN row is branched on by KIND rather than fed a fabricated reach. It
 *  is a door, not a listener: there is no bind observation to judge — the
 *  scanner has positively said nothing is behind it — so the only address kolu
 *  can honestly offer for it is the door itself, and there is no reason to give
 *  for a port not being open as-is. The previous shape minted a
 *  `{ kind: "needs-forward", via: "loopback" }` behind an `as` cast, which
 *  asserted a bind nobody observed, put a value into the union the judge never
 *  produced, and switched off the one check that would have caught either. */
export function rowAction(opts: {
  row: PortRow;
  onKoluHost: boolean;
  viewerOnHost: boolean;
}): { action: PortAction; reason: string | undefined } {
  if (opts.row.kind === "orphan") {
    return { action: { kind: "forward" }, reason: undefined };
  }
  const reach = portReach({
    scope: opts.row.info.scope,
    onKoluHost: opts.onKoluHost,
  });
  return {
    action: portAction({ reach, viewerOnHost: opts.viewerOnHost }),
    reason: reachReason(reach),
  };
}
