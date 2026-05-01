/**
 * Client-side transport primitives — protocol-aware glue between an oRPC
 * link and the framework's hooks.
 *
 * The framework owns the streaming retry contract on the wire: every
 * `Cell.get` / `Collection.get` / `Stream.get` call rides infinite retry
 * with snapshot-then-deltas semantics, so a transport drop transparently
 * re-subscribes and the next yield is a fresh full snapshot. Threading
 * that context manually at every call site is the cultural rule that the
 * framework exists to delete; consumers feed `client.X.get` to a hook and
 * the retry plumbing happens inside.
 *
 * This module is intentionally thin — `streamCall` for raw streaming
 * RPCs that don't fit a descriptor (bidirectional binary streams,
 * lifecycle events), `createCellsClient` for the one-time link
 * construction. Solid-specific hooks live in `./solid`.
 */

import { createORPCClient, ORPCError } from "@orpc/client";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";
import { RPCLink } from "@orpc/client/websocket";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";

export type { ClientRetryPluginContext };

/** Retry context applied to every framework-driven streaming call.
 *  Transport errors retry forever (next iterator yields a fresh
 *  snapshot — see Cell/Collection/Stream invariants); application
 *  errors propagate so consumers can surface them. */
export const STREAM_RETRY: ClientRetryPluginContext = {
  retry: Number.POSITIVE_INFINITY,
  retryDelay: (o) => o.lastEventRetry ?? 1000,
  shouldRetry: ({ error }) => !(error instanceof ORPCError),
};

/** Shape of an oRPC streaming procedure: takes an input and an options
 *  bag (signal + retry context), returns an AsyncIterable. The framework's
 *  hooks accept these refs directly so consumers don't hand-thread retry
 *  context per call. */
export type StreamingProcedure<I, O> = (
  input: I,
  opts: { signal?: AbortSignal; context?: ClientRetryPluginContext },
) => Promise<AsyncIterable<O>>;

/** Call a streaming procedure with `STREAM_RETRY` context applied. The
 *  one-line escape hatch for raw streaming RPCs that don't fit a
 *  Cell/Collection/Stream descriptor — bidirectional binary attaches,
 *  lifecycle events, anything outside the three primitives. For those
 *  that do fit, prefer the matching hook; it wraps internally.
 *
 *  When `onRetry` is supplied, it merges into the retry context so the
 *  plugin invokes the callback before each re-subscribe. Used by xterm's
 *  attach loop to clear the buffer before the new iterator's first
 *  snapshot lands. */
export function streamCall<I, O>(
  procedure: StreamingProcedure<I, O>,
  input: I,
  opts?: { signal?: AbortSignal; onRetry?: () => void },
): Promise<AsyncIterable<O>> {
  return procedure(input, {
    signal: opts?.signal,
    context: opts?.onRetry
      ? { ...STREAM_RETRY, onRetry: opts.onRetry }
      : STREAM_RETRY,
  });
}

/** Build a typed oRPC client wired to a WebSocket transport with
 *  `ClientRetryPlugin` installed. Consumers feed the returned client
 *  to `useCell` / `useCollection` / `useStream` for streaming, and use
 *  it directly for one-shot mutations and queries (those don't go
 *  through retry — the plugin's default `retry: 0` fails them fast).
 *
 *  Generic parameter is the contract type so the returned client is
 *  fully typed end-to-end:
 *
 *  ```ts
 *  const client = createCellsClient<typeof contract>({ websocket: ws });
 *  ```
 *
 *  The websocket is passed through unchanged — partysocket and other
 *  reconnecting variants are accepted via the standard `WebSocket`
 *  shape (the cast is the consumer's responsibility, since reconnect
 *  policy is orthogonal to retry). */
export function createCellsClient<C extends AnyContractRouter>(opts: {
  websocket: WebSocket;
}): ContractRouterClient<C, ClientRetryPluginContext> {
  const link = new RPCLink<ClientRetryPluginContext>({
    websocket: opts.websocket,
    plugins: [new ClientRetryPlugin()],
  });
  return createORPCClient<ContractRouterClient<C, ClientRetryPluginContext>>(
    link,
  );
}
