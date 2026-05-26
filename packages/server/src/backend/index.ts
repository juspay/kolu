/**
 * Backend registry — resolves which `Backend` owns a given location.
 *
 * R-2 introduces:
 *  - `RemoteBackend` cache keyed by host (per `HostSession` is per-host
 *    singleton; multiple terminals on one host share one session).
 *  - `getBackendForCreate` — variant for the create path that resolves
 *    sub-terminal inheritance (a child of a remote tile spawns on the
 *    same host regardless of what the client requested).
 *
 * Pre-implementation review finding J: keep `installAgent` OUT of
 * resolver. The resolver returns synchronously and is called on every
 * read path (`terminal.attach`, etc.). `installAgent` is an ssh
 * round-trip that must happen ONCE per host, explicitly, before any
 * other backend op. The SSH host picker triggers it (see
 * `../sshHosts.ts:installSshHost`).
 */

import type { Backend } from "kolu-common/backend";
import type { TerminalLocation } from "kolu-common/surface";
import { getTerminal } from "../terminal-registry.ts";
import { HostSession } from "./host-session.ts";
import { localBackend } from "./local.ts";
import { RemoteBackend } from "./remote.ts";

export { localBackend } from "./local.ts";

const remoteCache = new Map<string, RemoteBackend>();

/** Resolve which backend owns a given terminal location. R-2: switches
 *  on `location.kind`; SSH branch returns a cached `RemoteBackend` (or
 *  constructs one — but does NOT install the agent; that's
 *  `installSshHost` in the host-picker flow). */
export function getBackendFor(location: TerminalLocation): Backend {
  if (location.kind === "local") return localBackend;
  let backend = remoteCache.get(location.host);
  if (!backend) {
    backend = new RemoteBackend(new HostSession(location.host));
    remoteCache.set(location.host, backend);
  }
  return backend;
}

/** Create-path variant. Resolves sub-terminal location inheritance: a
 *  child of a remote tile spawns on the same host regardless of what
 *  the input specifies. Centralizing this here means
 *  `terminals.ts:createTerminal` doesn't pattern-match on parent
 *  state — pre-impl review finding J. */
export function getBackendForCreate(opts: {
  location?: TerminalLocation;
  parentId?: string;
}): Backend {
  // Sub-terminal: inherit parent's location.
  if (opts.parentId) {
    const parent = getTerminal(opts.parentId);
    if (parent) return getBackendFor(parent.meta.location);
  }
  return getBackendFor(opts.location ?? { kind: "local" });
}

/** For shutdown: tear down all cached `HostSession`s. */
export function disposeAllRemoteBackends(): void {
  for (const _backend of remoteCache.values()) {
    // R-3: RemoteBackend.dispose() would call session.dispose().
    // Sketch only for the prototype.
  }
  remoteCache.clear();
}
