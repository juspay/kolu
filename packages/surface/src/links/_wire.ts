/**
 * Shared internals for the **wire** links (`websocket`, `stdio`) — the members
 * that cross a transport. The in-process `directLink` is deliberately NOT built
 * here: it has no transport, so it installs no retry plugin and wraps no oRPC
 * link. Keeping the retry policy and the typed-client wrap in one place means a
 * change to the retry contract has a single home, and a future third wire link
 * (a unix socket, say) inherits both for free instead of copying them.
 *
 * Package-internal (underscore prefix) — not exported through any
 * `@kolu/surface/*` subpath.
 */

import { type ClientLink, createORPCClient } from "@orpc/client";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { shouldNotRetryORPCError } from "../client";

/** The plugins every wire link installs at link construction. `ClientRetryPlugin`
 *  retries transport errors forever so a dropped connection transparently
 *  re-subscribes (the next iterator yields a fresh snapshot — see the
 *  Cell/Collection/Stream invariants). One home for the policy; one-shot
 *  mutations/queries don't retry (the plugin's default `retry: 0`).
 *
 *  The default `shouldRetry` fence excludes `ORPCError` — an application
 *  error the server chose to raise (retrying just repeats it), and the shape
 *  a dead stdio link now rejects with (`SURFACE_STDIO_TRANSPORT_CLOSED`). So a
 *  caller that opts into `retry: N` won't burn N round-trips against a closed
 *  transport. Same predicate `STREAM_RETRY` threads per-call, named once in
 *  `client.ts` so the two can't drift. */
export function wireRetryPlugins(): ClientRetryPlugin<ClientRetryPluginContext>[] {
  return [
    new ClientRetryPlugin<ClientRetryPluginContext>({
      default: { shouldRetry: shouldNotRetryORPCError },
    }),
  ];
}

// Every client built over a real WIRE transport — by identity. A wire transport
// can silently HALF-OPEN: the socket/pipe stays `open` at the OS level while no
// bytes flow either way — a websocket whose TCP connection wedged, a stdio/ssh
// pipe whose peer partitioned with no FIN — so a client over it has NO honest
// transport-liveness of its own; that signal must come from a watchdog (the
// heartbeat `connectSurface`/`connectSurfaces` wire in, or, over ssh stdio,
// `surface-nix-host`'s `hostSession.startLiveness`). Recording the brand HERE —
// the one chokepoint EVERY wire link crosses (`websocketLink`, `stdioLink`, and
// so `unixSocketLink`, which wraps `stdioLink`) — means a NEW wire link inherits
// the guard BY CONSTRUCTION and can't forget to brand itself. The in-process
// `directLink` (`createRouterClient`, no transport) bypasses `wireClient`, so it is
// unbranded and its constant-`true` leg is honest. (A hand-rolled foreign oRPC
// client over a websocket — one that skips `websocketLink` — is also unbranded and
// would reach the constant-`true` fallback; that is the documented by-exclusion
// RESIDUAL in `surfaceClient`'s `resolveTransport`, discouraged by routing every
// client through the blessed factories.) `surfaceClient` / `surfaceClients` consult
// {@link isHalfOpenLink} to FAIL FAST when handed a bare branded wire link instead
// of a watchdog-backed `LiveSignalHandle`, rather than silently defaulting the
// transport leg to constant-`true` — the green/ready-dot-over-a-dead-link lie
// (#1564), one seam upstream of the dot.
// A WeakSet keyed on the opaque oRPC proxy (by identity, never mutating it,
// GC-safe).
const HALF_OPEN_LINKS = new WeakSet<object>();

/** True if `link` was built by a wire link factory (anything that crosses a
 *  transport via {@link wireClient} — `websocketLink`, `stdioLink`,
 *  `unixSocketLink`) — a transport that can silently half-open, so its
 *  `health().live` is a LIE unless a liveness watchdog supplies the real
 *  transport signal. `surfaceClient`/`surfaceClients` consult this to crash
 *  loudly when such a bare link arrives instead of a watchdog-backed
 *  `LiveSignalHandle`, rather than defaulting the transport leg to
 *  constant-`true`. The in-process `directLink` bypasses `wireClient`, so it is
 *  never recorded and its constant-`true` leg stays honest. */
export function isHalfOpenLink(link: unknown): boolean {
  return (
    (typeof link === "object" || typeof link === "function") &&
    link !== null &&
    HALF_OPEN_LINKS.has(link as object)
  );
}

/** Wrap a constructed oRPC link in the typed contract client every wire link
 *  returns — centralizes the `ClientRetryPluginContext` binding so the wire
 *  links don't each restate it, AND brands the result half-openable (see
 *  {@link HALF_OPEN_LINKS}) so the half-open-blind transport leg is unspellable
 *  over EVERY wire link, not just websocket — at the one seam they all cross. */
export function wireClient<C extends AnyContractRouter>(
  link: ClientLink<ClientRetryPluginContext>,
): ContractRouterClient<C, ClientRetryPluginContext> {
  const client =
    createORPCClient<ContractRouterClient<C, ClientRetryPluginContext>>(link);
  // Brand at the chokepoint: a wire transport can silently half-open, so
  // `surfaceClient` must refuse this bare client unless it is wrapped in a
  // watchdog-backed `LiveSignalHandle`.
  HALF_OPEN_LINKS.add(client as object);
  return client;
}
