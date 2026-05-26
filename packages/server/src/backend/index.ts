/**
 * Backend registry — resolves which `Backend` owns a given location.
 *
 * R-1: only `LocalBackend` exists, so the resolver returns the
 * singleton unconditionally. R-2 will add a per-host `RemoteBackend`
 * map keyed by `location.host`, and the resolver becomes a `switch` on
 * `location.kind`.
 *
 * Keeping the resolver behind a single function — even when it's
 * trivial — means R-2 is a localized change (this file + a new
 * `remote.ts`) rather than a hunt-and-replace across the codebase.
 */

import type { Backend } from "kolu-common/backend";
import type { TerminalLocation } from "kolu-common/surface";
import { localBackend } from "./local.ts";

export { localBackend } from "./local.ts";

/** Resolve which backend owns a given terminal location. Takes
 *  `TerminalLocation` directly so create-path callers (who don't yet
 *  have a registry entry) and read-path callers (who have an entry's
 *  `meta.location`) share one signature.
 *
 *  R-1: every location resolves to the local singleton. R-2 makes this
 *  `match(location).with({ kind: "local" }, …).with({ kind: "ssh" }, …)`
 *  against a per-host `RemoteBackend` cache. */
export function getBackendFor(_location: TerminalLocation): Backend {
  // R-1: only `LocalBackend` exists. R-2 dispatches by `_location.kind`.
  return localBackend;
}
