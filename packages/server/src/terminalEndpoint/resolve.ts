/**
 * `resolveTerminalEndpoint` — map a terminal's `HostLocation` to the
 * `TerminalEndpoint` that owns it. THE single seam where a location becomes a
 * concrete endpoint: `router.ts`, `surface.ts`, and `terminals.ts` route every
 * per-terminal op through here instead of importing `localTerminalEndpoint`
 * directly, so the remote arm (R9.2) is one `case` added in THIS file — never a
 * hunt across the three call sites. That is the whole job of the R9.1 retrofit:
 * make the remote endpoint purely additive.
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
