/**
 * Backend registry — resolves which `Backend` owns a given terminal.
 *
 * R-1: only `LocalBackend` exists, so the resolver returns the
 * singleton unconditionally. R-2 will add a per-host `RemoteBackend`
 * map keyed by `entry.meta.location.host`, and the resolver becomes a
 * `switch` on `entry.meta.location.kind`.
 *
 * Keeping the resolver behind a single function — even when it's
 * trivial — means R-2 is a localized change (this file + a new
 * `remote.ts`) rather than a hunt-and-replace across the codebase.
 */

import type { Backend } from "kolu-common/backend";
import type { TerminalProcess } from "../terminal-registry.ts";
import { localBackend } from "./local.ts";

export { localBackend } from "./local.ts";

/** Resolve which backend owns a terminal — read from its persisted
 *  location. R-1: always returns the local singleton; R-2 will look up
 *  a per-host `RemoteBackend` instance. */
export function getBackendFor(_entry: TerminalProcess): Backend {
  // R-1: only `LocalBackend` exists. Once `RemoteBackend` lands in R-2
  // this becomes a switch on `entry.meta.location.kind`.
  return localBackend;
}
