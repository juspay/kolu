/**
 * Client-side streaming helpers. `unenrolledStreamCall` is the one-shot escape
 * hatch for raw streaming RPCs that don't fit a Cell/Collection/Stream
 * descriptor, and `STREAM_RETRY` is the retry context the framework threads
 * through every such call. The transport constructors that *build* a client
 * live in the link family (`./links/websocket`, `./links/stdio`,
 * `./links/direct`); Solid-specific hooks live in `./solid`.
 *
 * The name is a WARNING. This call does NOT enrol into any `client.health()`
 * fact — it is the deliberately-unenrolled primitive, for a ROOT RPC stream
 * that belongs to no surface (the terminal `attach`), or as the inner factory
 * of a `createSubscription` that owns its OWN `pending`/`error` and joins via
 * `client.enroll`. For a SURFACE-scoped raw stream use `client.rawStream`
 * instead — it enrols structurally and throws if you forget the owner. So a
 * bare `unenrolledStreamCall` at a call site reads as "I am intentionally
 * outside the health fact", never as a forgotten enrol.
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

/** The two codes a permanently-dead transport rejects with. Distinct strings
 *  (so a consumer can tell *which* transport died) but one shape: both flow
 *  through `deadTransportError` so neither can drift from the non-retry
 *  contract `shouldNotRetryORPCError` above enforces. */
export const SURFACE_TRANSPORT_RETIRED = "SURFACE_TRANSPORT_RETIRED";
export const SURFACE_STDIO_TRANSPORT_CLOSED = "SURFACE_STDIO_TRANSPORT_CLOSED";

/** The error a permanently-dead transport throws so the shared retry policy
 *  (`shouldNotRetryORPCError`) classifies it as non-retriable. An `ORPCError`
 *  — NOT a plain `Error`: the retry fence above only suppresses `ORPCError`, so
 *  a plain throw from a dead transport would still look like a retriable
 *  transport error and re-subscribe forever (each retry firing the stream's
 *  `onRetry`, e.g. clearing a terminal buffer behind the reload overlay).
 *
 *  One factory for both transports — the retired websocket
 *  (`SURFACE_TRANSPORT_RETIRED`) and the closed stdio link
 *  (`SURFACE_STDIO_TRANSPORT_CLOSED`) — so the "non-retry shape the fence
 *  recognizes" is encoded in exactly one place. Per-site `message` strings stay
 *  caller-supplied; only the construction routes through here. */
export function deadTransportError(
  code: string,
  message: string,
): ORPCError<string, unknown> {
  return new ORPCError(code, { message });
}

/** Retry context applied to every framework-driven streaming call.
 *  Transport errors retry forever (next iterator yields a fresh
 *  snapshot — see Cell/Collection/Stream invariants); application
 *  errors propagate so consumers can surface them. Internal —
 *  consumers thread it via the hooks (`useCell` etc.) or
 *  `unenrolledStreamCall`, never directly. */
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

/** Call a streaming procedure with `STREAM_RETRY` context applied, WITHOUT
 *  enrolling it into any `client.health()` fact. The one-line escape hatch for
 *  raw streaming RPCs that don't fit a Cell/Collection/Stream descriptor —
 *  bidirectional binary attaches, lifecycle events, anything outside the three
 *  primitives. For those that do fit, prefer the matching hook; it wraps
 *  internally. For a SURFACE-scoped raw stream that SHOULD be in the health
 *  fact, use `client.rawStream` (structural, throws outside an owner) — reach
 *  for this only when the stream is deliberately outside a surface's health
 *  (a root RPC) or is hand-joined via `client.enroll`; the `unenrolled-` prefix
 *  makes that choice legible at the call site.
 *
 *  When `onRetry` is supplied, it merges into the retry context so the
 *  plugin invokes the callback before each re-subscribe. Used by xterm's
 *  attach loop to clear the buffer before the new iterator's first
 *  snapshot lands. */
export function unenrolledStreamCall<I, O>(
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
