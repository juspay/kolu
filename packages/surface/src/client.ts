/**
 * Client-side streaming helpers. `streamCall` is the one-shot escape hatch
 * for raw streaming RPCs that don't fit a Cell/Collection/Stream descriptor,
 * and `STREAM_RETRY` is the retry context the framework threads through every
 * such call. The transport constructors that *build* a client live in the
 * link family (`./links/websocket`, `./links/stdio`, `./links/direct`);
 * Solid-specific hooks live in `./solid`.
 */

import { ORPCError } from "@orpc/client";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";

/** The retry policy shared across transports: retry transport errors,
 *  never an `ORPCError` (an application-level error the server chose to
 *  raise — retrying it just repeats the same failure). Named once here so
 *  `STREAM_RETRY` (per-call streaming context) and the stdio link's
 *  factory-level `ClientRetryPlugin` default can't drift apart. */
export const shouldNotRetryORPCError: ClientRetryPluginContext["shouldRetry"] =
  ({ error }) => !(error instanceof ORPCError);

/** Retry context applied to every framework-driven streaming call.
 *  Transport errors retry forever (next iterator yields a fresh
 *  snapshot — see Cell/Collection/Stream invariants); application
 *  errors propagate so consumers can surface them. Internal —
 *  consumers thread it via the hooks (`useCell` etc.) or `streamCall`,
 *  never directly. */
export const STREAM_RETRY: ClientRetryPluginContext = {
  retry: Number.POSITIVE_INFINITY,
  retryDelay: (o) => o.lastEventRetry ?? 1000,
  shouldRetry: shouldNotRetryORPCError,
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
