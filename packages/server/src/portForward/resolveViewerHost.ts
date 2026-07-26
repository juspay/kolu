/**
 * "Which of kolu's hosts is this browser sitting at?" — the resolver that joins
 * the pure decision table in `@kolu/surface/viewerIdentity` to the two facts only
 * the running server has: its own interface addresses, and what each ssh
 * destination resolves to.
 *
 * Split from the decision table on purpose. That file is pure and total, so its
 * every arm is pinned by a table of literals; this one touches DNS and the OS,
 * so it is the part that has to be injected to be tested at all. Keeping them in
 * one file would have dragged a resolver into the tests of a comparison.
 */

import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { decodeHostKey, type HostKey } from "kolu-common/hostKey";
import {
  effectiveViewerAddress,
  sshTargetHostname,
  viewerIsOnHost,
} from "@kolu/surface/viewerIdentity";

/** Every address THIS machine answers on — what makes a connection from a local
 *  reverse proxy recognisable as a local hop.
 *
 *  Re-read per call rather than cached: an interface can come and go (a tailnet
 *  link, a VPN, a docker bridge), and the read is a cheap in-process syscall. A
 *  cached list that missed a new interface would silently stop trusting the
 *  proxy that arrived with it. */
/** Did the lookup fail because the answer is "not now" rather than "not a
 *  name"? Only the latter is a fact worth caching for the process's life.
 *  `EAI_AGAIN` is the resolver saying it could not reach a server, and the
 *  socket-level codes are the same story a layer down. */
function isTransientLookupFailure(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return (
    code === "EAI_AGAIN" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "ENETUNREACH" ||
    code === "ESERVFAIL"
  );
}

export function ownAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .map((a) => a.address);
}

export function makeViewerHostResolver(deps: {
  /** The pool's current membership, encoded. */
  hosts: () => readonly string[];
  /** Resolve a hostname to addresses. Injected so the resolver is testable and
   *  so the cache below is this module's, not DNS's. */
  resolve?: (hostname: string) => Promise<readonly string[]>;
  /** This machine's own addresses. Injected for the same reason. */
  own?: () => readonly string[];
}): (connection: {
  peerAddress: string | undefined;
  forwardedFor: string | undefined;
}) => Promise<HostKey | null> {
  const own = deps.own ?? ownAddresses;
  /** Cached for the process's life, keyed by hostname. It is a DNS answer about
   *  a machine in the user's own fleet, re-read only across a restart — and the
   *  cost of it being stale is that a chip offers the forward that already
   *  works, which is what every other uncertain case does. */
  const cache = new Map<string, readonly string[]>();
  const resolveOnce = async (hostname: string): Promise<readonly string[]> => {
    const hit = cache.get(hostname);
    if (hit !== undefined) return hit;
    let found: readonly string[] = [];
    try {
      found =
        deps.resolve === undefined
          ? (await lookup(hostname, { all: true })).map((a) => a.address)
          : await deps.resolve(hostname);
    } catch (err) {
      // Unresolvable is the ORDINARY case for an ssh alias, not an anomaly, so
      // this is not logged at error — it simply means kolu cannot recognise a
      // viewer sitting at that host, and the forward stays.
      //
      // But a TRANSIENT failure is not that answer, and caching it would be: a
      // resolver blink at boot would disable viewer recognition for the life of
      // the process, with no way back short of a restart. A definitive "this
      // name does not exist" is a fact worth keeping; "ask me later" is not.
      if (isTransientLookupFailure(err)) return [];
      found = [];
    }
    cache.set(hostname, found);
    return found;
  };

  return async function viewerHost(connection) {
    // WHOSE address to judge by. Behind a reverse proxy the TCP peer is the
    // proxy — measured on production, `tailscale serve` dials the backend from
    // this host's OWN tailnet address — so the viewer's address only exists in
    // the forwarded header, and only a trusted peer may vouch for it.
    const viewerAddress = effectiveViewerAddress({
      peerAddress: connection.peerAddress,
      forwardedFor: connection.forwardedFor,
      hostAddresses: own(),
    });
    if (viewerAddress === undefined) return null;
    for (const encoded of deps.hosts()) {
      const host = decodeHostKey(encoded);
      // Only REMOTE hosts are asked about: kolu's local host is the machine
      // serving the page, so a port there is already the direct-open arm's
      // business and needs no identity check.
      if (host.kind !== "remote") continue;
      const addresses = await resolveOnce(sshTargetHostname(host.target));
      if (viewerIsOnHost({ viewerAddress, hostAddresses: addresses })) {
        return host;
      }
    }
    return null;
  };
}
