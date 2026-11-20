import { lookup } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { decodeHostKey, type HostKey } from "kolu-common/hostKey";
import { viewerAddressOf, viewerIsOnHost } from "@kolu/surface/viewer-identity";

export function sshTargetHostname(target: string): string {
  const at = target.lastIndexOf("@");
  return at === -1 ? target : target.slice(at + 1);
}

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

function rememberOnlyDefinitiveAnswers(
  lookupAddresses: (hostname: string) => Promise<readonly string[]>,
): (hostname: string) => Promise<readonly string[]> {
  const remembered = new Map<string, readonly string[]>();
  return async (hostname: string): Promise<readonly string[]> => {
    const hit = remembered.get(hostname);
    if (hit !== undefined) return hit;
    let answer: readonly string[] = [];
    try {
      answer = await lookupAddresses(hostname);
    } catch (err) {
      if (isTransientLookupFailure(err)) return [];
    }
    remembered.set(hostname, answer);
    return answer;
  };
}

export interface ViewerConnection {
  readonly peerAddress: string | undefined;
  /** The raw `X-Forwarded-For`, in whichever shape the request carried it —
   *  `viewerAddressOf` takes both, so no entry point has to normalise first. */
  readonly forwardedFor: string | readonly string[] | null | undefined;
}

export function makeViewerHostResolver(deps: {
  /** The pool's current membership, encoded. */
  hosts: () => readonly string[];
  resolve?: (hostname: string) => Promise<readonly string[]>;
  own?: () => readonly string[];
}): (connection: ViewerConnection) => Promise<HostKey | null> {
  const own = deps.own ?? ownAddresses;
  const resolveOnce = rememberOnlyDefinitiveAnswers(
    deps.resolve ??
      (async (hostname) =>
        (await lookup(hostname, { all: true })).map((a) => a.address)),
  );

  return async function viewerHost(connection) {
    const viewerAddress = viewerAddressOf({
      peerAddress: connection.peerAddress,
      forwardedFor: connection.forwardedFor,
      hostAddresses: own(),
    });
    if (viewerAddress === undefined) return null;
    for (const encoded of deps.hosts()) {
      const host = decodeHostKey(encoded);
      if (host.kind !== "remote") continue;
      const addresses = await resolveOnce(sshTargetHostname(host.target));
      if (viewerIsOnHost({ viewerAddress, hostAddresses: addresses })) {
        return host;
      }
    }
    return null;
  };
}
