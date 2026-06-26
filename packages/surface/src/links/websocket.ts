/**
 * WebSocket link — connect a typed oRPC client over a `WebSocket`.
 *
 * A surface *link* is "a way to reach the served contract": it returns a
 * `ContractRouterClient<C>` you call directly (or hand to `surfaceClient`
 * for Solid hooks). This is the browser-facing member of the family —
 * `stdioLink` (subprocess / ssh) and `directLink` (in-process, no wire) are
 * the others. The client is the only abstraction that spans all of them,
 * because the direct link has no transport at all.
 *
 * `ClientRetryPlugin` is installed so framework-driven streaming calls
 * re-subscribe transparently on reconnect (the next iterator yields a fresh
 * snapshot — see the Cell/Collection/Stream invariants). One-shot mutations
 * and queries don't retry (the plugin's default `retry: 0` fails them fast).
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import { RPCLink } from "@orpc/client/websocket";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import { wireClient, wireRetryPlugins } from "./_wire";

// Every client `websocketLink` builds, by identity. A WebSocket transport can
// silently HALF-OPEN — the socket stays `open` at the OS level while no bytes
// flow either way — so a client over it has NO honest transport-liveness of its
// own; that signal must be supplied by a watchdog (the heartbeat
// `connectSurface`/`connectSurfaces` wire in). A WeakSet (keyed on the opaque
// oRPC proxy by identity, never mutating it, GC-safe) lets `surfaceClient` /
// `surfaceClients` FAIL FAST when handed such a link with no `{ live }`, rather
// than silently defaulting the transport leg to constant-`true` — the
// green/ready-dot-over-a-dead-link lie (#1564), one seam upstream. The
// in-process links (`directLink`/`stdioLink`) are NOT recorded: they cannot
// half-open, so their constant-`true` transport leg is honest by construction.
const HALF_OPEN_LINKS = new WeakSet<object>();

/** True if `link` was built by {@link websocketLink} — a transport that can
 *  silently half-open, so its `health().live` is a LIE unless a liveness
 *  watchdog supplies the real transport signal. `surfaceClient`/`surfaceClients`
 *  consult this to crash loudly when such a link arrives with no `{ live }`,
 *  instead of defaulting the transport leg to constant-`true`. */
export function isHalfOpenLink(link: unknown): boolean {
  return (
    (typeof link === "object" || typeof link === "function") &&
    link !== null &&
    HALF_OPEN_LINKS.has(link as object)
  );
}

/** Connect a typed oRPC client over a WebSocket transport, with
 *  `ClientRetryPlugin` installed. The contract type parameter pins the
 *  client end-to-end:
 *
 *  ```ts
 *  const client = websocketLink<typeof contract>(ws);
 *  // …or, for Solid hooks. A websocket CAN half-open, so `surfaceClient`
 *  // REQUIRES a watchdog-backed `{ live }` here (a bare client throws): reach
 *  // for `connectSurface`, or mint it with `createLiveSignal` (see below).
 *  const link = websocketLink<typeof contract>(ws);
 *  const { live } = createLiveSignal(ws, { probe: () => probeSurfaceLive(link) });
 *  const app = surfaceClient(surface, link, { live });
 *  ```
 *
 *  The websocket is passed through unchanged — partysocket and other
 *  reconnecting variants are accepted via the standard `WebSocket` shape
 *  (the cast is the caller's responsibility, since reconnect policy is
 *  orthogonal to retry). */
export function websocketLink<C extends AnyContractRouter>(
  websocket: WebSocket,
): ContractRouterClient<C, ClientRetryPluginContext> {
  const link = new RPCLink<ClientRetryPluginContext>({
    websocket,
    plugins: wireRetryPlugins(),
  });
  const client = wireClient<C>(link);
  // Record this client as half-openable so `surfaceClient`/`surfaceClients`
  // refuse it without a `{ live }` watchdog (see `HALF_OPEN_LINKS` above).
  HALF_OPEN_LINKS.add(client as object);
  return client;
}
