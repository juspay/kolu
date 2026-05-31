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

/** Connect a typed oRPC client over a WebSocket transport, with
 *  `ClientRetryPlugin` installed. The contract type parameter pins the
 *  client end-to-end:
 *
 *  ```ts
 *  const client = websocketLink<typeof contract>(ws);
 *  // …or, for Solid hooks:
 *  const app = surfaceClient(surface, websocketLink<typeof contract>(ws));
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
  return wireClient<C>(link);
}
