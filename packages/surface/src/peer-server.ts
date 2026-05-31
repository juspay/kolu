/**
 * Peer server — pumps any typed oRPC router through `ServerPeer` over a
 * stdio stream pair.
 *
 * Headline API: `serveOverStdio({ router, transport })`. Default transport
 * is `process.stdin` / `process.stdout` (the subprocess agent case);
 * loopback consumers pass the `server` half of a `LoopbackPair`.
 *
 * ## Stdout IS the protocol channel
 *
 * In an agent process that calls `serveOverStdio()` with no `transport`
 * override, `process.stdout` is the wire. Any extraneous write to stdout
 * — a stray `console.log`, a pino log line, anything — corrupts the next
 * frame and the client peer dies with `SyntaxError: Unexpected token '«'`
 * (the leading byte of base64-decoded garbage). This is lesson #4 from
 * the Zed reference work, and the failure mode is reproducible on demand:
 * see the deliberately-broken `--broken-stdout-log` variant in the
 * remote-process-monitor example's agent.
 *
 * **Defensive measure**: when `transport` is unset *and* this module
 * detects it's running as an stdio agent (the typical case — explicit
 * `--stdio` arg or no TTY on stdout), it preemptively redirects
 * `console.log` to `process.stderr`. This catches the most common
 * accidental writes; consumers that use third-party loggers (pino, etc.)
 * must still configure them to fd 2 themselves. The detection is
 * intentionally tight (explicit signal only) so the function stays safe
 * to call from non-agent contexts (e.g. tests using a `LoopbackPair`)
 * without surprising stderr redirection.
 *
 * ## Router wrapping caveat
 *
 * `implementSurface(...).router` returns a router *fragment* — a plain
 * record of handlers, not a top-level router from `implement(contract)`.
 * `StandardRPCHandler` needs the latter. Consumers wire it up at the
 * call site:
 *
 * ```ts
 * const fragment = implementSurface(surface, deps).router;
 * const router = implement(contract).router(fragment);
 * await serveOverStdio({ router });
 * ```
 *
 * `serveOverStdio` doesn't do the wrap itself because the contract isn't
 * available here without an extra arg, and the wrap is symmetric with how
 * `RPCHandler` (the WebSocket variant) gets called.
 *
 * ## Deferred heartbeat
 *
 * `serveOverStdio` does not start any heartbeat. Heartbeat is a
 * client-side concern (the agent doesn't know who its clients are; the
 * client knows whether *its* link is healthy). Clients that need
 * heartbeat layer it on top of the link by calling a no-op procedure on
 * an interval — and they MUST defer the first heartbeat until *after* the
 * first real RPC roundtrips successfully (lesson #6). A nix-realisation
 * wait can take many minutes, and a premature heartbeat would falsely
 * fire "disconnected" before the first response arrives. See R-2's
 * `HostSession` for the deferred-heartbeat consumer.
 */

import type { Readable, Writable } from "node:stream";
import { type Context, implement, type Router } from "@orpc/server";
import type { StandardRPCHandlerOptions } from "@orpc/server/standard";
import { StandardRPCHandler } from "@orpc/server/standard";
// `Router<any, T>` is the exact shape `StandardRPCHandler` expects;
// matching it avoids needing consumers to re-wrap an `implementSurface`
// fragment through `implement(contract).router(fragment)`.
import {
  createServerPeerHandleRequestFn,
  type HandleStandardServerPeerMessageOptions,
} from "@orpc/server/standard-peer";
import { ServerPeer } from "@orpc/standard-server-peer";
import { encodeFrame, readFramedLines } from "./links/stdio-codec";

/** Transport override for `serveOverStdio`. Default is `process.stdin`
 *  for `read` and `process.stdout` for `write`. */
export interface StdioTransport {
  read: Readable;
  write: Writable;
}

export interface ServeOverStdioOptions<T extends Context> {
  /** Top-level router accepted by `StandardRPCHandler`. The
   *  `implementSurface` fragment's `.router` field is already at the
   *  top level (it includes the `surface` namespace internally), so
   *  pass it directly — no second `implement(contract).router(...)`
   *  wrap needed. */
  // biome-ignore lint/suspicious/noExplicitAny: mirrors `StandardRPCHandler`'s constructor signature (`Router<any, T>`); narrowing here would force consumers to refit their fragment through another generic and the existing example pattern of passing `fragment.router` straight in would no longer type-check.
  router: Router<any, T>;
  /** Stream pair override. Omit for the default `process.stdin` /
   *  `process.stdout` (the subprocess-agent case). */
  transport?: StdioTransport;
  /** Forwarded to `StandardRPCHandler`. Mostly for serializer/context
   *  customization. */
  handlerOptions?: StandardRPCHandlerOptions<T>;
  /** Per-request context for the handler. Typically empty for stdio
   *  agents (no request-scoped auth — the link itself is the trust
   *  boundary). */
  requestContext?: HandleStandardServerPeerMessageOptions<T>;
  /** Called once, synchronously, after the first request has been
   *  *received and dispatched* (i.e. the first frame was successfully
   *  decoded — not necessarily after the handler returned). Useful for a
   *  client wrapper that wants to flip "connecting" → "connected" the
   *  moment the link demonstrably works in both directions. */
  onFirstRequest?: () => void;
}

/** Serve a typed oRPC router over a stdio transport. Resolves when the
 *  read stream ends (the parent disconnected); the returned Promise is
 *  long-lived for the lifetime of the agent process. */
export function serveOverStdio<T extends Context>(
  opts: ServeOverStdioOptions<T>,
): Promise<void> {
  const transport: StdioTransport = opts.transport ?? {
    read: process.stdin,
    write: process.stdout,
  };
  const usingDefaultStdout = opts.transport === undefined;

  // Lesson #4 defensive measure: when we own stdout (no override), route
  // console.log to stderr so accidental writes don't corrupt the wire.
  if (usingDefaultStdout) {
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      process.stderr.write(`${args.map((a) => String(a)).join(" ")}\n`);
    };
    // Keep a reference so consumers can opt out if they have a specific
    // diagnostic need. (Tests don't hit this branch because they pass
    // a transport override.)
    (console as unknown as { logToStderr: typeof origLog }).logToStderr =
      origLog;
  }

  const handler = new StandardRPCHandler<T>(opts.router, opts.handlerOptions);
  let firstRequestSeen = false;

  const writeLine = (line: string): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      transport.write.write(`${line}\n`, (err) =>
        err == null ? resolve() : reject(err),
      );
    });

  const peer = new ServerPeer((message) => writeLine(encodeFrame(message)));

  return readFramedLines(transport.read, (frame) => {
    if (!firstRequestSeen) {
      firstRequestSeen = true;
      opts.onFirstRequest?.();
    }
    // Mirror the client-side handling in `links/stdio.ts` — a malformed
    // frame (e.g. agent stdout corruption per lesson #4, or a flap on
    // the wire) makes `peer.message` reject. Catch it here; the alternative
    // is an unhandled-rejection that crashes the agent. Already-in-flight
    // RPCs continue to work; the bad frame just doesn't decode.
    peer
      .message(
        frame,
        createServerPeerHandleRequestFn(
          handler,
          opts.requestContext ??
            ({} as HandleStandardServerPeerMessageOptions<T>),
        ),
      )
      .catch((err) => {
        process.stderr.write(
          `[@kolu/surface/peer-server] inbound frame parse failure: ${
            (err as Error).message
          }\n`,
        );
      });
  }).finally(() => {
    peer.close();
  });
}

/** Re-export `implement` from `@orpc/server` so agent authors can wrap a
 *  surface fragment in a top-level router without pulling in
 *  `@orpc/server` directly. Avoids the "router fragment doesn't work"
 *  footgun documented in this module's header. */
export { implement };
