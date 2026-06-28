/**
 * `resolveTerminalEndpoint` — map a terminal's `HostLocation` to the
 * `TerminalEndpoint` that owns it. THE single seam where a location becomes a
 * concrete endpoint; `router.ts`, `surface.ts`, and `terminals.ts` route their
 * per-terminal ops through here instead of importing `localTerminalEndpoint`
 * directly. The seam is consumed two ways today, and only one is yet additive:
 *
 *  - LOCATION-PASSING sites — attach (`router.ts`) and kill (`terminals.ts`)
 *    pass a terminal's OWN `meta.location`. For these the remote arm (R9.2) is
 *    one `case` added in THIS file, never a hunt across the call sites.
 *  - CONSTANT-PINNED sites — createTerminal (`terminals.ts`) and the fs/git
 *    streams (`surface.ts`) resolve the hardcoded `LOCAL_LOCATION` (via the
 *    `localEndpoint` alias), not a per-terminal location. Adding the remote
 *    `case` here does NOT route them remote; each still needs its own future
 *    edit to thread a real location (R9.2 for create, R9.5 for the fs/git
 *    streams). The seam is in place; the location is not yet plumbed through.
 *
 * That is the R9.1 retrofit: make the remote endpoint purely additive for the
 * location-passing sites, and stand the seam in front of the constant-pinned
 * ones so their future edit is local to one call site.
 *
 * Local-only today. `{ kind: "local" }` (`LOCAL_LOCATION`) is the only location
 * any terminal carries, and the in-process `localTerminalEndpoint` is the only
 * arm. A `{ kind: "remote" }` location cannot exist until R9.2 dials one, so a
 * non-local location FAILS LOUDLY here rather than silently degrading onto the
 * local PTY — the no-fallbacks stance (a remote terminal quietly served by the
 * local endpoint would be a wrong-host bug, not a graceful default). R9.2
 * replaces the throw with the ssh kaval dial; there is no `RemoteTerminalEndpoint`
 * yet.
 */

import type { HostLocation } from "kolu-common/surface";
import type { TerminalEndpoint } from "kolu-common/terminalEndpoint";
import { localTerminalEndpoint } from "./local.ts";

export function resolveTerminalEndpoint(
  location: HostLocation,
): TerminalEndpoint {
  if (location.kind === "local") return localTerminalEndpoint;
  // R9.2 adds the remote arm above this guard. Until then no terminal carries a
  // remote location, so reaching here is a contract violation — crash loudly.
  throw new Error(
    `no terminal endpoint for remote host "${location.hostId}" — remote dialing lands in R9.2`,
  );
}
