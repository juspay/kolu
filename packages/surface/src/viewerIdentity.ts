/**
 * "Which machine is the viewer actually AT?" — the transport fact behind any
 * per-viewer decision a surface-served app makes.
 *
 * It lives in `@kolu/surface` because it hides a real volatility that has
 * nothing to do with any one app: PROXY TOPOLOGY. Kolu got it wrong twice in a
 * day — first comparing the TCP peer (which is the proxy, not the viewer, behind
 * `tailscale serve`), then having to work out which forwarded header may be
 * believed and when. Drishti's web face is deployed the same way and needs the
 * identical answer the day it makes any per-viewer decision.
 *
 * Pure and total, with the OS-touching half (DNS, interface enumeration) left to
 * the consumer: what this owns is the JUDGMENT, which is the part that was hard.
 *
 * ## The original question, kept because it is the worked example
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

/** The loopback addresses, in the spellings {@link normalizeAddress} produces. */
const LOOPBACK = new Set(["127.0.0.1", "::1"]);

/** Is the machine at the other end of this connection a hop we may believe about
 *  somebody ELSE's address?
 *
 *  Trusted means the connection came from this machine: loopback, or one of the
 *  server host's own addresses. That second arm is not a generosity — it is the
 *  measured shape of the deployment. `tailscale serve` terminates TLS and dials
 *  the backend from the HOST'S OWN tailnet address, so the proxy hop is
 *  indistinguishable from the machine itself, and on production the only
 *  established connection to kolu had peer `100.122.32.106` — pureintent.
 *
 *  A fact about the connection, deliberately, and not a setting. There is no
 *  "trusted proxies" list to configure and get wrong: either the connection came
 *  from this machine or it did not. */
export function isTrustedLocalPeer(
  peerAddress: string | undefined,
  hostAddresses: readonly string[],
): boolean {
  if (peerAddress === undefined || peerAddress === "") return false;
  const peer = normalizeAddress(peerAddress);
  if (LOOPBACK.has(peer)) return true;
  // A v4 loopback is the whole `127.0.0.0/8`, same as the port scanner reads it.
  if (peer.startsWith("127.")) return true;
  return hostAddresses.some((a) => normalizeAddress(a) === peer);
}

/** WHOSE address to judge the viewer by — the direct peer, or the client a
 *  trusted proxy vouched for.
 *
 *  This exists because the first cut of the feature never fired once in the
 *  field. It compared the TCP peer, and behind `tailscale serve` the TCP peer is
 *  the kolu host itself; the viewer's real address was sitting unread in a
 *  header the whole time. The comparison was right, the observation was the
 *  proxy's.
 *
 *  The trust gate is the security of the whole thing, so it is stated as an
 *  order rather than a preference:
 *
 *   1. No connection → no answer.
 *   2. Peer NOT trusted → the peer, and the header is ignored ENTIRELY. Anyone
 *      who can reach kolu directly can send any header they like, and honouring
 *      it would let a stranger claim to be sitting at any host in the fleet.
 *   3. Peer trusted → the LAST entry of the forwarded header, which is the hop
 *      that proxy actually received from. Not the first: a client can pre-set
 *      `X-Forwarded-For`, and each proxy APPENDS, so the leftmost entry is
 *      whatever the client typed and the rightmost is what the trusted hop
 *      vouched for.
 *   4. Trusted peer, no usable header → the peer. Not a proxy at all, just
 *      somebody browsing on the kolu host, and the peer is the honest answer. */
export function effectiveViewerAddress(opts: {
  peerAddress: string | undefined;
  /** The raw `X-Forwarded-For`, if the request carried one. */
  forwardedFor: string | undefined;
  /** This server host's own addresses. */
  hostAddresses: readonly string[];
}): string | undefined {
  if (opts.peerAddress === undefined || opts.peerAddress === "") {
    return undefined;
  }
  if (!isTrustedLocalPeer(opts.peerAddress, opts.hostAddresses)) {
    return opts.peerAddress;
  }
  const vouched = (opts.forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .at(-1);
  return vouched ?? opts.peerAddress;
}

/** The `X-Forwarded-For` value as ONE string, from either shape a node request
 *  can hand over.
 *
 *  Node gives a repeated header as an ARRAY, and a proxy chain legitimately
 *  produces one — so the halves are re-joined in arrival order, which keeps the
 *  "last entry is the closest hop" rule true across both spellings. An absent
 *  header stays `undefined` rather than becoming `""`: "no proxy said anything"
 *  and "a proxy said nothing usable" are different facts, and only the first
 *  means there was no proxy. */
export function forwardedForOf(
  header: string | readonly string[] | null | undefined,
): string | undefined {
  if (header === null || header === undefined) return undefined;
  return Array.isArray(header) ? header.join(",") : (header as string);
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
