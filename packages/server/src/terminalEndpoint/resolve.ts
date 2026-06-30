/**
 * The package-private HOST REGISTRY — the one place a `HostLocation` becomes a
 * concrete `TerminalEndpoint`, and the one place that holds the live endpoints.
 *
 * This is the sealed boundary of PR-0. The local endpoint instance
 * (`localTerminalEndpoint`) is imported HERE and nowhere else; no caller can reach
 * it directly. Everything downstream routes through one of four exits, each scoped
 * to its consumer so a hard-pin is structurally unspellable:
 *
 *  - `resolveTerminalEndpoint(location)` → the COMMON `TerminalEndpoint` (the
 *    id-keyed per-terminal lifecycle). Imported ONLY by the lifecycle façade
 *    (`terminals.ts`); the `sealed-dispatch` guard pins that. The kaval-typed
 *    host-scoped ops (killAll / adopt) are NOT on this type, so a per-terminal
 *    caller cannot reach a host's drain or boot-adopt through it.
 *  - `forEachHost(fn)` → iterate every host's SERVER endpoint. The ONLY entry for
 *    killAll, so "killAll on only the local host" is unspellable (there is no
 *    single-host accessor a caller can hard-pin).
 *  - `serverEndpointFor(scope)` → the SERVER endpoint for a branded `HostScope`.
 *    The boot/inventory adoption resolves through here. It takes a `HostScope`
 *    (constructed ONLY in this module), not a raw location, so a per-terminal seam
 *    cannot fabricate one to reach the host-scoped adopt ops.
 *  - `localFsGitEndpoint()` → the fs/git surfaces ONLY (`TerminalWorkspaceEndpoint`),
 *    for `surface.ts`. Narrowed to fs · git, so the Code-tab's server access stays
 *    alive through the sealed boundary WITHOUT re-exposing a lifecycle hatch.
 *
 * Local-only today. `{ kind: "local" }` (`LOCAL_LOCATION`) is the only location any
 * terminal carries; the in-process `localTerminalEndpoint` is the only live arm. A
 * `{ kind: "remote" }` location FAILS LOUDLY (no-fallbacks) rather than degrading
 * onto the local PTY — F-REMOTE replaces the throw with the ssh kaval dial and
 * registers the dialed host here.
 */

import type { TerminalWorkspaceEndpoint } from "@kolu/terminal-workspace/endpoint";
import { type HostLocation, LOCAL_LOCATION } from "kolu-common/surface";
import type { TerminalEndpoint } from "kolu-common/terminalEndpoint";
import { match } from "ts-pattern";
import { LOCAL_HOST_ID } from "../ptyHost/index.ts";
import { localTerminalEndpoint, type ServerTerminalEndpoint } from "./local.ts";

declare const hostScopeBrand: unique symbol;

/** A host kolu drives, identified by BOTH its daemon `hostId` (the daemon-status
 *  key, the kaval socket it talks to) AND the `location` its terminals carry. The
 *  two are paired here, at the ONE construction site, so a caller cannot hand the
 *  boot adoption a mismatched `(hostId, location)` — the brand makes a hand-built
 *  scope a type error. F-REMOTE dials a kaval and registers its scope here. */
export interface HostScope {
  readonly hostId: string;
  readonly location: HostLocation;
  readonly [hostScopeBrand]: true;
}

/** The ONE place a `HostScope` is minted — pairs `hostId` with `location` so the
 *  two can't drift. Module-private: every scope a consumer holds came from
 *  `hostScopes()` (or `forEachHost`), never a hand-built pair. */
function makeScope(hostId: string, location: HostLocation): HostScope {
  return { hostId, location } as HostScope;
}

/** The registered host scopes — `(hostId, location)` pairs only, NO endpoint
 *  instance, so this list is safe to build eagerly at module-eval (the endpoint is
 *  resolved LAZILY below, at call time, to stay clear of the `localTerminalEndpoint`
 *  TDZ across the surface load cycle). One `local` scope today; F-REMOTE pushes a
 *  dialed host's scope per ssh kaval. A list, not a singleton, so the session-global
 *  ops (`forEachHost`, the boot sweep) are host-keyed by construction — but PR-0
 *  dials no remote, so the single local scope keeps every resolution byte-identical. */
const HOST_SCOPES: readonly HostScope[] = [
  makeScope(LOCAL_HOST_ID, LOCAL_LOCATION),
];

/** The SERVER endpoint owning `location` (with the host-scoped adopt/killAll ops),
 *  or a loud throw on a host kolu has not registered. The local arm reads
 *  `localTerminalEndpoint` through a THUNK (evaluated at call time, never at
 *  module-eval) so this module never trips the surface-cycle TDZ on it. */
function endpointForLocation(location: HostLocation): ServerTerminalEndpoint {
  return match(location)
    .with({ kind: "local" }, () => localTerminalEndpoint)
    .with({ kind: "remote" }, ({ hostId }) => {
      // No terminal carries a remote location until F-REMOTE dials one and registers
      // it — so reaching here is a contract violation. Crash loudly rather than
      // degrade onto the local PTY (the no-fallbacks stance).
      throw new Error(
        `no terminal endpoint for remote host "${hostId}" — remote dialing lands in F-REMOTE`,
      );
    })
    .exhaustive();
}

/** Map a terminal's `HostLocation` to the COMMON `TerminalEndpoint` that owns it.
 *  THE single seam where a location becomes a concrete endpoint — imported ONLY by
 *  the lifecycle façade (`terminals.ts`), which resolves `getTerminal(id).meta.location`
 *  internally on every per-terminal op. Returns the narrow common interface, so the
 *  host-scoped ops stay out of a per-terminal caller's reach. */
export function resolveTerminalEndpoint(
  location: HostLocation,
): TerminalEndpoint {
  return endpointForLocation(location);
}

/** Run `fn` against EVERY host's server endpoint. The only entry for session-global
 *  ops (killAll) — there is no single-host accessor a caller can hard-pin, so
 *  "killAll on only the local host" is unspellable. One host today. */
export async function forEachHost(
  fn: (endpoint: ServerTerminalEndpoint) => Promise<void>,
): Promise<void> {
  for (const scope of HOST_SCOPES)
    await fn(endpointForLocation(scope.location));
}

/** The `(hostId, location)` scope of every registered host — the boot-adoption
 *  sweep iterates these, reconciling each host independently. One local scope today. */
export function hostScopes(): readonly HostScope[] {
  return HOST_SCOPES;
}

/** The SERVER endpoint for a branded `HostScope` — the boot/inventory adoption's
 *  exit. Takes a `HostScope` (minted only in this module), never a raw location, so
 *  a per-terminal seam can't fabricate one to reach the host-scoped adopt ops. */
export function serverEndpointFor(scope: HostScope): ServerTerminalEndpoint {
  return endpointForLocation(scope.location);
}

/** The LOCAL host's fs/git surfaces ONLY — `surface.ts`'s sealed accessor for the
 *  Code-tab's one-shot fs/git ops + watcher streams. Narrowed to `{ fs, git }`
 *  (`TerminalWorkspaceEndpoint`), so deleting the public `localEndpoint` alias keeps
 *  fs/git's server access alive WITHOUT handing surface.ts a lifecycle endpoint it
 *  could hard-pin. PR-2 builds per-location fs/git on top; today it's local. */
export function localFsGitEndpoint(): TerminalWorkspaceEndpoint {
  return endpointForLocation(LOCAL_LOCATION);
}
