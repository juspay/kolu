/**
 * The N-endpoint registry (P3) — resolve a terminal's `TerminalEndpoint` from
 * its hostId. The re-introduction of the resolver P0 (#1364) deliberately
 * removed, now that there is a real second implementation to dispatch to: a
 * second KEY (the host), not the speculative topology P0 collapsed.
 *
 * The `local` entry is the existing `localTerminalEndpoint` singleton —
 * `endpointFor(undefined)` / `endpointFor("local")` is byte-identical to the
 * pre-P3 direct reference. A non-local hostId lazily builds (and caches) a
 * `RemoteTerminalEndpoint` from the host registry's dial config — one ssh
 * session per host, reused across that host's terminals.
 *
 * `localTerminalEndpoint` is read INSIDE `endpointFor` (call time), never at
 * module top level, so this module can't reintroduce the #1005 init-order TDZ.
 */

import { ORPCError } from "@orpc/server";
import type { TerminalId } from "kolu-common/surface";
import type { TerminalEndpoint } from "kolu-common/terminalEndpoint";
import { hostConfigFor } from "../hosts/registry.ts";
import { LOCAL_HOST_ID } from "../ptyHost/index.ts";
import { getTerminal } from "../terminal-registry.ts";
import { localTerminalEndpoint } from "./local.ts";
import { RemoteTerminalEndpoint } from "./remote.ts";

const remoteEndpoints = new Map<string, RemoteTerminalEndpoint>();

/** Resolve the endpoint that owns a terminal on `hostId`. Undefined / `"local"`
 *  ⇒ the local endpoint. A configured remote host ⇒ its (cached) remote
 *  endpoint. An unknown host throws a typed NOT_FOUND. */
export function endpointFor(hostId?: string): TerminalEndpoint {
  if (!hostId || hostId === LOCAL_HOST_ID) return localTerminalEndpoint;
  const existing = remoteEndpoints.get(hostId);
  if (existing) return existing;
  const config = hostConfigFor(hostId);
  if (!config) {
    throw new ORPCError("NOT_FOUND", {
      message: `no host configured for "${hostId}"`,
    });
  }
  const endpoint = new RemoteTerminalEndpoint({
    hostId,
    host: config.host,
    resolveDrvPath: config.resolveDrvPath,
  });
  remoteEndpoints.set(hostId, endpoint);
  return endpoint;
}

/** Resolve the endpoint that OWNS an existing terminal id — reads the registry
 *  entry's `location.hostId` (absent ⇒ local) and delegates to `endpointFor`.
 *  The single home for "terminal id → owning endpoint", so id-keyed ops
 *  (kill/attach) can't each re-spell the host-resolution rule. */
export function endpointForTerminal(id: TerminalId): TerminalEndpoint {
  return endpointFor(getTerminal(id)?.meta.location?.hostId);
}

/** Every endpoint with live state — the local one plus every dialed remote.
 *  `killAllTerminals` fans out across all of them. */
export function allEndpoints(): TerminalEndpoint[] {
  return [localTerminalEndpoint, ...remoteEndpoints.values()];
}
