/**
 * "Is the browser looking at kolu running ON one of kolu's own hosts?"
 *
 * The case this answers, from the field: the human browses kolu from *zest*,
 * and *zest* is also one of kolu's remote hosts. Every port chip on zest's
 * terminals offered a forward — opening a door on the kolu server so that zest's
 * browser could reach a port on zest. It works, and it is a pointless round trip
 * through a third machine to reach the machine you are already sitting at.
 *
 * The comparison is the browser's own PEER ADDRESS (the address its connection
 * to kolu comes from — a fact only the server can see) against the addresses a
 * host resolves to. Kolu-server owns both ends of that: it accepts the
 * connection, and it holds the host's ssh destination.
 *
 * **The failure direction is deliberate and load-bearing.** A match makes a chip
 * open directly; NO match leaves the forward exactly as it is today. So every
 * way this can fail to recognise the viewer — a NAT, a proxy, an ssh alias that
 * DNS cannot resolve, a host reached through a jump box — degrades to the
 * behaviour that already works, never to a broken link. That is what makes an
 * inexact comparison acceptable here at all; it would not be if a wrong answer
 * cost the user a dead tab in the common case.
 */

/** Strip an address down to the form two spellings of the same address share.
 *
 *  Three normalizations, each for a spelling node or a browser really produces:
 *
 *   - **`::ffff:1.2.3.4`** — a v4 peer on a dual-stack listener is reported in
 *     v4-mapped form by `socket.remoteAddress`, while DNS returns the bare
 *     `1.2.3.4`. This is the same collapse `addressBind` makes for the scanner,
 *     and for the same reason: they are one address written two ways.
 *   - **`fe80::1%eth0`** — a link-local address carries a zone id that belongs to
 *     the observer, not to the address.
 *   - **`[::1]`** — brackets are URL syntax that can ride in from a header.
 *
 *  Case is folded because hex in a v6 address is case-insensitive. */
export function normalizeAddress(address: string): string {
  let a = address.trim().toLowerCase();
  if (a.startsWith("[") && a.endsWith("]")) a = a.slice(1, -1);
  const zone = a.indexOf("%");
  if (zone !== -1) a = a.slice(0, zone);
  if (a.startsWith("::ffff:") && a.includes(".")) a = a.slice("::ffff:".length);
  return a;
}

/** Is the viewer sitting at this host?
 *
 *  Pure and total, so the whole decision is testable without a socket or a
 *  resolver: the caller supplies what it observed (the connection's peer
 *  address) and what it resolved (the host's addresses), and this owns only the
 *  comparison.
 *
 *  `undefined`/empty on either side is NOT a match. That direction is the safe
 *  one — see the module doc: an unrecognised viewer keeps the forward, which
 *  works, while a falsely recognised one gets a direct link to its own machine
 *  that may have nothing behind it. */
export function viewerIsOnHost(opts: {
  /** The peer address of the viewer's connection to kolu. */
  viewerAddress: string | undefined;
  /** Every address the host is known to answer at. */
  hostAddresses: readonly string[];
}): boolean {
  if (opts.viewerAddress === undefined || opts.viewerAddress === "") {
    return false;
  }
  const viewer = normalizeAddress(opts.viewerAddress);
  if (viewer === "") return false;
  return opts.hostAddresses.some((a) => normalizeAddress(a) === viewer);
}

/** The hostname half of an ssh destination — `user@box` → `box`, `box` → `box`.
 *
 *  Only the hostname is resolvable, and only what a resolver can take is worth
 *  handing one. A destination this cannot reduce to a plausible hostname (an
 *  `~/.ssh/config` alias that names no real host) simply fails to resolve later,
 *  which lands on the safe no-match side. */
export function sshTargetHostname(target: string): string {
  const at = target.lastIndexOf("@");
  return at === -1 ? target : target.slice(at + 1);
}
