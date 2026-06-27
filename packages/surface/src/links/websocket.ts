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

// A websocket can silently HALF-OPEN — the socket stays `open` at the OS level
// while no bytes flow either way — so a client over it has NO honest
// transport-liveness of its own; that signal must be supplied by a watchdog (the
// heartbeat `connectSurface`/`connectSurfaces` wire in). It is NOT special in
// this: every WIRE link can half-open (a wedged stdio peer, a partitioned ssh
// pipe), so the half-open brand lives at `wireClient` (`./_wire`) — the one
// chokepoint every wire link crosses — and `isHalfOpenLink` is re-exported here
// for the `@kolu/surface/links/websocket` subpath's back-compat. Only the
// in-process `directLink` (which bypasses `wireClient`, no transport) stays
// unbranded, so it is the only link whose constant-`true` transport leg is honest.
export { isHalfOpenLink } from "./_wire";

/** Connect a typed oRPC client over a WebSocket transport, with
 *  `ClientRetryPlugin` installed. The contract type parameter pins the
 *  client end-to-end:
 *
 *  ```ts
 *  const client = websocketLink<typeof contract>(ws);
 *  // …or, for Solid hooks. A websocket CAN half-open, so `surfaceClient` REQUIRES
 *  // a watchdog-backed handle (a bare client throws): reach for `connectSurface`,
 *  // or use `createLiveSignal`, which BUILDS the link over `ws` itself (so the
 *  // watchdog probes the socket it reconnects) and returns ONE handle pairing
 *  // `link` + `live`. Pass that whole handle — there is no `{ live }` seam:
 *  const transport = createLiveSignal<typeof contract>(ws, {});
 *  const app = surfaceClient(surface, transport);
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
  // `wireClient` brands the result half-openable (see `./_wire`), so
  // `surfaceClient`/`surfaceClients` refuse this bare client unless it is wrapped
  // in a watchdog-backed `LiveSignalHandle`.
  return wireClient<C>(link);
}
