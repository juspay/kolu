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

/** The ONE `ORPCError` code that is RETRYABLE (SR5 — "one protocol across the
 *  wire"). A re-serving parent's fail-through relay ends its downstream with this
 *  code when its UPSTREAM link to the agent is lost (no live upstream at subscribe,
 *  or a mid-stream link death), so the browser's `STREAM_RETRY` re-subscribes
 *  end-to-end and a fresh snapshot leads the new stream. It is the NAMED retryable
 *  transport end the reServe relay produces (`RelayTransportLostError`,
 *  `@kolu/surface-remote`), and it crosses oRPC as an `ORPCError` — code PRESERVED,
 *  not sanitized — so the fence below can recognize it on the far side. The dual of
 *  `deadTransportError`'s codes: those are permanently dead (never retry), this one
 *  is a transient middle-hop drop the parent will heal. */
export const SURFACE_RELAY_TRANSPORT_LOST = "SURFACE_RELAY_TRANSPORT_LOST";

/** The retry policy shared across transports: retry transport errors, and the ONE
 *  named RETRYABLE relay end ({@link SURFACE_RELAY_TRANSPORT_LOST} — a re-serve's
 *  transient upstream drop), but never any OTHER `ORPCError` (an application-level
 *  error the server chose to raise — retrying it just repeats the same failure, and
 *  it is the non-retriable shape a permanently-dead transport rejects with). Named
 *  once here so `STREAM_RETRY` (per-call streaming context) and the stdio link's
 *  factory-level `ClientRetryPlugin` default can't drift apart. */
export const shouldNotRetryORPCError: ClientRetryPluginContext["shouldRetry"] =
  ({ error }) =>
    !(error instanceof ORPCError) ||
    error.code === SURFACE_RELAY_TRANSPORT_LOST;

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

/** Recognize the permanently-dead transport shapes {@link deadTransportError}
 *  mints — the RECOGNITION twin of that factory, colocated with the codes so the
 *  "which codes mean the transport itself died" knowledge lives in ONE place, next
 *  to the factory and the retry fence it stays in lockstep with. A re-serve relay
 *  uses it to tell a middle-hop transport death (translate to the retryable relay
 *  end) from an application `ORPCError` the agent raised (surface unchanged). Add a
 *  transport link with a new dead code here (beside `deadTransportError`) and every
 *  recognizer — not just the denylist fence — picks it up, closing the silent-drift
 *  gap an ad-hoc code list at the relay would otherwise open. */
export function isDeadTransportError(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    (error.code === SURFACE_STDIO_TRANSPORT_CLOSED ||
      error.code === SURFACE_TRANSPORT_RETIRED)
  );
}

/** Is `reason` the greppable {@link deadTransportError}(`SURFACE_STDIO_TRANSPORT_CLOSED`)
 *  a closed stdio link raises (#1719)? Brand-checked on `ORPCError` + the exact code,
 *  so it holds across module-instance / realm boundaries (the robustness oRPC errors
 *  use), and DELIBERATELY tight: it matches nothing but that one transport-closed error.
 *
 *  Narrower than {@link isDeadTransportError} (which also spans the retired websocket) —
 *  this is the single stdio-close code. A re-serve CONSUMER that dials the relay with a
 *  raw client (no `STREAM_RETRY` plugin) uses it — with {@link isSurfaceRelayTransportLost}
 *  — to recognize a transport-loss end and RE-SUBSCRIBE across a reconnect window,
 *  mirroring what `STREAM_RETRY` does for a plugin-equipped client (see the padiBinding
 *  reconnect test). */
export function isSurfaceStdioTransportClosed(reason: unknown): boolean {
  return (
    reason instanceof ORPCError &&
    reason.code === SURFACE_STDIO_TRANSPORT_CLOSED
  );
}

/** Is `reason` the reServe relay's RETRYABLE middle-hop transport-loss end —
 *  `RelayTransportLostError` (`@kolu/surface-remote`), an `ORPCError` with the
 *  {@link SURFACE_RELAY_TRANSPORT_LOST} code? Brand-checked on `ORPCError` + the exact
 *  code, like {@link isSurfaceStdioTransportClosed}, and just as tight.
 *
 *  When a bound upstream (a padi) dies mid-stream, the re-serve relay
 *  (`failThroughStreamCore`) CATCHES the stdio close and re-throws it WRAPPED as this
 *  retryable relay end, so a live client re-subscribes end-to-end. A raw-client consumer
 *  (no `STREAM_RETRY`) recognizes it here to retry across the reconnect gap. It stays
 *  NARROW: the relay re-throws genuine application errors UNCHANGED, so this exact code
 *  is ALWAYS a benign transport-loss end, never an app error. */
export function isSurfaceRelayTransportLost(reason: unknown): boolean {
  return (
    reason instanceof ORPCError && reason.code === SURFACE_RELAY_TRANSPORT_LOST
  );
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
