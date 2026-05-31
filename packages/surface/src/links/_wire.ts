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

/** Wrap a constructed oRPC link in the typed contract client every wire link
 *  returns — centralizes the `ClientRetryPluginContext` binding so the two
 *  wire links don't each restate it. */
export function wireClient<C extends AnyContractRouter>(
  link: ClientLink<ClientRetryPluginContext>,
): ContractRouterClient<C, ClientRetryPluginContext> {
  return createORPCClient<ContractRouterClient<C, ClientRetryPluginContext>>(
    link,
  );
}
