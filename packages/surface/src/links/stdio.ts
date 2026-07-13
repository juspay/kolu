/**
 * Stdio link adapter — oRPC client over a `Readable`/`Writable` pair.
 *
 * Wires a `ClientPeer` (from `@orpc/standard-server-peer`) to a Node stream
 * pair via base64+newline framing. Direction-neutral options (`read` /
 * `write`) so client and server use the same shape.
 *
 * Framing rationale (why base64+newline): see `./stdio-codec.ts`.
 *
 * Stdout-is-protocol gotcha (lesson #4): on the *server* side (the
 * subprocess), stdout IS the protocol channel. Any extraneous write to
 * stdout corrupts the next frame and the client peer dies with
 * `SyntaxError: Unexpected token '«'` (the leading byte of base64-decoded
 * garbage). Consumers of `serveOverStdio` must redirect logs to fd 2.
 * See `peer-server.ts` for the symmetric server-side note.
 *
 * Reconnect: this link does not reconnect — the link is bound to one
 * stream pair, and a stream close ends the link. Callers that need
 * reconnect should layer it on top by tearing down and constructing a new
 * link against a fresh stream pair. (R-2's `HostSession` is the
 * canonical example.)
 */

import type { Readable, Writable } from "node:stream";
import type { ClientContext, ClientOptions } from "@orpc/client";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type {
  StandardLinkClient,
  StandardRPCLinkOptions,
} from "@orpc/client/standard";
import { StandardRPCLink } from "@orpc/client/standard";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import type {
  StandardLazyResponse,
  StandardRequest,
} from "@orpc/standard-server";
import { ClientPeer } from "@orpc/standard-server-peer";
import { deadTransportError, SURFACE_STDIO_TRANSPORT_CLOSED } from "../client";
import { wireClient, wireRetryPlugins } from "./_wire";
import { framedSend, readFramedLines } from "./stdio-codec";

/** A `Readable`/`Writable` pair the link reads and writes from. */
export interface StdioLinkOptions {
  /** Stream the link reads inbound messages from. For a subprocess
   *  client, this is `child.stdout`. For a loopback test, the server-side
   *  `read` half of the cross-piped pair. */
  read: Readable;
  /** Stream the link writes outbound messages to. For a subprocess
   *  client, this is `child.stdin`. For a loopback test, the server-side
   *  `write` half of the cross-piped pair. */
  write: Writable;
}

/** Client-side `StandardLinkClient` implementation backed by a stdio pair.
 *  The browser/WebSocket counterpart is `LinkWebsocketClient`. */
export class LinkStdioClient<T extends ClientContext>
  implements StandardLinkClient<T>
{
  private readonly peer: ClientPeer;
  /** Set once the inbound stream ends or errors — the transport is gone
   *  (the subprocess exited, the ssh pipe dropped). The peer can never
   *  produce a response after that, so `call()` rejects immediately
   *  rather than awaiting one forever. Without this guard a request
   *  issued on an already-dead link hangs: the link is bound to one
   *  stream pair (see the header note — it does not reconnect), so a
   *  consumer that hands a stale client to a fresh request gets a promise
   *  that never settles. The parent's reconnect bridge did exactly that —
   *  its `system.get` pump, re-issued against the just-exited child's
   *  client, never resolved and never errored, so the reconnect loop
   *  wedged and every respawned agent sat idle until the connect watchdog
   *  reaped it. */
  private closed = false;

  constructor(opts: StdioLinkOptions) {
    this.peer = new ClientPeer((message) => framedSend(opts.write, message));
    // The write half needs its own 'error' sink. A failed `write()` already
    // rejects the in-flight frame through the callback above, but Node ALSO
    // emits 'error' on the stream itself — and an 'error' event with no
    // listener is a hard process crash, not a catchable rejection. The pipe
    // torn down mid-write is the routine case, not the exotic one: the ssh
    // transport drops, or the peer exits and our `write` is its now-closed
    // stdin, and the next frame raises EPIPE. Without this listener that
    // EPIPE takes the whole process down (it felled a consumer's coordinator
    // on teardown — destroying the lane mid-write, the unhandled 'error'
    // crashed the process). A write error means one thing — the transport is
    // gone — so route it through the same teardown the inbound stream's
    // end/error takes: mark the link closed so later `call()`s reject fast
    // instead of limping on a dead pipe. Symmetric with the read half's
    // `read.on("error", …)` guard in `stdio-codec.ts`.
    opts.write.on("error", (err) => {
      process.stderr.write(
        `[@kolu/surface/links/stdio] outbound write error: ${(err as Error).message}\n`,
      );
      this.handleTransportClosed();
    });
    readFramedLines(opts.read, (frame) => {
      // Swallow per-frame parse errors. A bad inbound frame is most
      // likely an agent-side stdout corruption (lesson #4); the
      // already-in-flight RPCs continue to work, and the consumer can
      // observe the failure via the stream's eventual end or via a
      // request timeout. Logging to stderr keeps the diagnostic visible
      // without crashing the link.
      this.peer.message(frame).catch((err) => {
        process.stderr.write(
          `[@kolu/surface/links/stdio] inbound frame parse failure: ${
            (err as Error).message
          }\n`,
        );
      });
      // Both settle paths tear the link down — `readFramedLines` resolves
      // on stream 'end' and rejects on 'error'. Handle both with `.then`
      // (NOT `.finally`, which would re-throw the rejection into this
      // discarded promise as an unhandled rejection).
    }).then(
      () => this.handleTransportClosed(),
      () => this.handleTransportClosed(),
    );
  }

  /** Inbound stream ended (or errored): the transport is dead. Mark the
   *  link closed so subsequent `call()`s reject, and close the peer —
   *  which rejects any request already in flight on its response queue.
   *
   *  IDEMPOTENT: multiple teardown paths converge here — the outbound
   *  `write.on("error")` (EPIPE) AND the inbound stream's end/error both fire on
   *  a dropped transport — so a second call must no-op.
   *
   *  TYPED close reason (#1719 mechanism fix). `peer.close()` → orpc's
   *  `AsyncIdQueue.close({ reason })` rejects every PENDING pull with `reason` when one
   *  is given, else it mints a FRESH, anonymous `AbortError` ("[AsyncIdQueue] Queue[N]
   *  … closed or aborted while waiting for pulling."). Those rejections deliver
   *  ASYNCHRONOUSLY on the pull awaiters, so a consumer that parked a `.next()` and was
   *  then abandoned mid-teardown floats it — and a bare `AbortError` is unowned and
   *  untyped, so a mirror consumer's swallow predicate (`isAbortReason`, keyed on
   *  `err === signal.reason`) cannot recognize it and mis-classifies it (the padi
   *  reconnect flake, juspay/kolu#1719). We pass an explicit TYPED reason
   *  ({@link deadTransportError} with {@link SURFACE_STDIO_TRANSPORT_CLOSED}), so the
   *  ONE thing that can cross the stdio seam at close is that single owned, greppable
   *  `ORPCError` — the same non-retriable shape `call()` already throws on a dead link,
   *  now also carried on every abandoned pull. The consumer-side ownership fix
   *  (mirrorCollection awaits its per-key pumps) is the other half; this typed reason is
   *  the seam fence that makes "an anonymous AbortError escapes the seam" unconstructible.
   *
   *  The `try/catch` remains a DEFENSIVE guard against a SYNCHRONOUS throw out of
   *  `peer.close()` (e.g. an in-flight request's abort listener throwing) — the async
   *  parked-pull rejections are handled by the typed reason above, not by this catch. */
  private handleTransportClosed(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.peer.close({
        reason: deadTransportError(
          SURFACE_STDIO_TRANSPORT_CLOSED,
          "stdio transport closed (the peer process exited or its stream ended); parked request/stream pulls are cancelled.",
        ),
      });
    } catch {
      // A synchronous throw out of `close()` (an abort listener) — the transport is
      // gone; nothing to reject that the close didn't already reject.
    }
  }

  async call(
    request: StandardRequest,
    _options: ClientOptions<T>,
    _path: readonly string[],
    _input: unknown,
  ): Promise<StandardLazyResponse> {
    if (this.closed) {
      throw deadTransportError(
        SURFACE_STDIO_TRANSPORT_CLOSED,
        "stdio transport is closed (the peer process exited or its stream ended); request not sent.",
      );
    }
    const response = await this.peer.request(request);
    return { ...response, body: () => Promise.resolve(response.body) };
  }
}

/** Options accepted by `StdioRPCLink`. `read` / `write` come from
 *  `StdioLinkOptions`; the rest mirror `StandardRPCLinkOptions` minus
 *  fields that don't apply to a non-HTTP transport (`url`, `method`,
 *  `fallbackMethod`, `maxUrlLength`). */
export interface StdioRPCLinkOptions<T extends ClientContext>
  extends Omit<
      StandardRPCLinkOptions<T>,
      "url" | "method" | "fallbackMethod" | "maxUrlLength"
    >,
    StdioLinkOptions {}

/** RPC link that communicates over a stdio stream pair using the same
 *  framing as `serveOverStdio` on the other end.
 *
 *  Symmetric with `RPCLink` from `@orpc/client/websocket` — wire shape on
 *  top of the link is the same RPC codec, only the transport changes. */
export class StdioRPCLink<T extends ClientContext> extends StandardRPCLink<T> {
  constructor(options: StdioRPCLinkOptions<T>) {
    super(new LinkStdioClient<T>(options), { ...options, url: "http://orpc" });
  }
}

/** Connect a typed oRPC client over a stdio transport, with the same
 *  `ClientRetryPlugin` install as `websocketLink` does for WebSocket — the
 *  subprocess / ssh member of the link family. The parent-side bridge of
 *  R-1.5's remote-process-monitor demo and R-2's `RemoteTerminalBackend`
 *  both call this. */
export function stdioLink<C extends AnyContractRouter>(
  opts: StdioLinkOptions,
): ContractRouterClient<C, ClientRetryPluginContext> {
  const link = new StdioRPCLink<ClientRetryPluginContext>({
    ...opts,
    plugins: wireRetryPlugins(),
  });
  return wireClient<C>(link);
}

// The base64+newline wire-framing codec (`encodeFrame` / `decodeFrame` /
// `readFramedLines`) lives in `./stdio-codec.ts`, shared with the server peer
// (`../peer-server.ts`) and kept off the public link export surface.
