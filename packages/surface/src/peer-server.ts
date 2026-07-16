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
 * ## Pass the router directly — no wrapping
 *
 * `implementSurface(...).router` (and the plural / re-serve constructors)
 * returns the FINAL top-level oRPC router, not a fragment. Hand it straight
 * to `serveOverStdio`; there is no `implement(contract).router(...)` wrap
 * anymore (SRT-PR1 retired it — a second finalize double-prefixes to
 * `/surface/surface/…` and every call 404s):
 *
 * ```ts
 * const { router } = implementSurface(surface, deps);
 * await serveOverStdio({ router });
 * ```
 *
 * ## Lifetime — the process IS the agent (default transport)
 *
 * A `serveOverStdio()` call with no `transport` override is the construction
 * that means "this process exists to serve this link": when the link ends,
 * the framework runs its teardown, lets the returned promise settle (so a
 * caller's synchronous post-settle cleanup still runs), then **exits the
 * process** — `0` on a clean end, `1` on a transport error. This is
 * framework-owned and has no opt-out: any live handle (a poll interval, a
 * watcher) would otherwise keep the event loop alive after the link died and
 * leave an invisible immortal orphan on someone else's machine (drishti#109
 * — ten re-parented `--stdio` agents on one fleet host). "Agent process
 * alive, link dead" is not a spellable state.
 *
 * An explicit `transport` override (loopback pairs in tests, a unix-socket
 * connection, any embedded peer) keeps today's semantics: the promise
 * resolves with how serving ended and the **caller** owns the process
 * lifetime.
 *
 * Post-settle work on the default arm: everything reachable from the settled
 * promise's microtask cascade (an `await serveOverStdio(…)` continuation
 * doing sync `dispose()` + logging) completes before the exit, which is
 * scheduled behind it with `setImmediate`. There is deliberately NO async
 * last-gasp hook: every known consumer's post-settle work is synchronous. If
 * a real consumer ever needs one, add it as a *partitioned* options type so
 * that `{ transport, onEnd }` fails to TYPECHECK (the hook is meaningless on
 * the caller-owned arm — make the combination unrepresentable, don't ignore
 * it or throw at runtime).
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
import type { Context, Router } from "@orpc/server";
import type { StandardRPCHandlerOptions } from "@orpc/server/standard";
import { StandardRPCHandler } from "@orpc/server/standard";
// `Router<any, T>` is the exact shape `StandardRPCHandler` expects; an
// `implementSurface` runtime's FINAL `.router` is already that shape, so it
// passes straight through with no re-wrap.
import {
  createServerPeerHandleRequestFn,
  type HandleStandardServerPeerMessageOptions,
} from "@orpc/server/standard-peer";
import { ServerPeer } from "@orpc/standard-server-peer";
import {
  framedSend,
  isBenignWriteError,
  readFramedLines,
} from "./links/stdio-codec";

/** Transport override for `serveOverStdio`. Default is `process.stdin`
 *  for `read` and `process.stdout` for `write`. */
export interface StdioTransport {
  read: Readable;
  write: Writable;
}

/** How a `serveOverStdio` call ended. `serveOverStdio` NEVER rejects —
 *  serving ends when the read stream does, and both ways it does so are
 *  ordinary peer-lifecycle events, not exceptional states for the serving
 *  process: `"end"` is a clean EOF (the peer closed its end / the parent
 *  exited), `"error"` is an abrupt transport death (peer reset, a pipe torn
 *  mid-frame), with the cause in `error`.
 *
 *  Rejecting on transport error was a crash footgun: a host serving many
 *  short-lived peers (e.g. `serveOverUnixSocket`'s per-connection serves)
 *  fires one of these promises per peer, and an un-`.catch()`-ed rejection
 *  from any flaky client became an unhandled rejection — fatal under
 *  `process.exit(1)`-on-unhandledRejection policies. A settled result makes
 *  the no-crash path the default; callers that care inspect `reason`. */
export interface ServeOverStdioEnd {
  reason: "end" | "error";
  /** The read-stream error when `reason === "error"`. */
  error?: unknown;
}

export interface ServeOverStdioOptions<T extends Context> {
  /** Top-level router accepted by `StandardRPCHandler`. An
   *  `implementSurface` runtime's `.router` is already the FINAL top-level
   *  router (it includes the `surface` namespace internally), so pass it
   *  directly — no `implement(contract).router(...)` wrap needed. */
  // biome-ignore lint/suspicious/noExplicitAny: mirrors `StandardRPCHandler`'s constructor signature (`Router<any, T>`); narrowing here would force consumers to refit their router through another generic and passing a runtime's `.router` straight in would no longer type-check.
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
 *  read stream ends (the parent disconnected) — with HOW it ended, never a
 *  rejection (see `ServeOverStdioEnd`); the returned Promise is long-lived
 *  for the lifetime of the agent process.
 *
 *  Lifetime is selected by construction (see "Lifetime" in the header): with
 *  no `transport` override the process IS the agent and the framework exits
 *  it after the promise settles (`0` on `"end"`, `1` on `"error"`); with an
 *  explicit `transport` the caller owns the process lifetime. */
export function serveOverStdio<T extends Context>(
  opts: ServeOverStdioOptions<T>,
): Promise<ServeOverStdioEnd> {
  const transport: StdioTransport = opts.transport ?? {
    read: process.stdin,
    write: process.stdout,
  };
  // The construction-time discriminant (see "Lifetime" in the header): no
  // transport override ⇒ this process IS the agent. Two consequences hang off
  // it — we own stdout (the console.log redirect below) and we own the
  // process lifetime (the exit fork at the bottom).
  const processIsTheAgent = opts.transport === undefined;

  // Lesson #4 defensive measure: when we own stdout (no override), route
  // console.log to stderr so accidental writes don't corrupt the wire.
  if (processIsTheAgent) {
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

  // Symmetric to the client link's write guard (`links/stdio.ts`). A failed
  // `write()` rejects the in-flight frame (the `writeFramedMessage` Promise
  // below), but Node also emits 'error' on the write stream, and an unhandled
  // 'error' is a hard crash — the very `process.exit(1)`-on-unhandled footgun
  // this module already closes for the *read* side (see `ServeOverStdioEnd`).
  // When our stdout pipe breaks (the parent died, the unix-socket peer reset),
  // serving must end the same way a read-side death ends it, not crash the
  // agent. Funnel the write error into the read stream's teardown so the
  // returned promise settles `{ reason: "error", error }` exactly as a read
  // error does — one teardown path, both directions. Guarded so a torn pipe
  // that kills both halves at once doesn't double-destroy.
  //
  // This 'error' lifecycle guard stays here, not in the codec's
  // `writeFramedMessage` (which is framing-only on purpose): the teardown
  // response is consumer-specific (the client closes its link instead).
  //
  // The funnel branches on the codec's own write-death classifier: a benign
  // write failure (EPIPE / ERR_STREAM_DESTROYED) IS clean peer-gone teardown
  // — on a parent death, an agent pushing frames often sees stdout-EPIPE
  // before stdin delivers EOF, and carrying that race as an *error* would
  // nondeterministically flip the same clean teardown between
  // `reason: "end"` and `reason: "error"` (and, on the default arm, between
  // exit 0 and exit 1 — which ssh propagates to Restart=on-failure units and
  // CI wrappers). Destroy without an error → 'close' → `reason: "end"`; a
  // real write failure still carries its error → `reason: "error"`.
  transport.write.on("error", (err) => {
    if (transport.read.destroyed) return;
    transport.read.destroy(isBenignWriteError(err) ? undefined : err);
  });

  const peer = new ServerPeer((message) =>
    framedSend(transport.write, message),
  );

  const settled = readFramedLines(transport.read, (frame) => {
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
  })
    .then(
      (): ServeOverStdioEnd => ({ reason: "end" }),
      (error: unknown): ServeOverStdioEnd => ({ reason: "error", error }),
    )
    .finally(() => {
      peer.close();
    });

  if (processIsTheAgent) {
    // Framework-owned exit (see "Lifetime" in the header): the layer that
    // saw the link die is the only one that can guarantee the process dies
    // with it — the app's `main` cannot know what else holds the event loop
    // (that unknowability is exactly what made the drishti#109 orphans
    // invisible). `setImmediate` is load-bearing: it fires only after the
    // ENTIRE microtask cascade from the settle drains, so every caller
    // continuation (`await serveOverStdio(…)` → sync dispose/log) completes
    // first. `process.nextTick` would preempt those continuations.
    void settled.then((end) => {
      setImmediate(() => {
        process.exit(end.reason === "end" ? 0 : 1);
      });
    });
  }

  return settled;
}
