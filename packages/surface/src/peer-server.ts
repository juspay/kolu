/**
 * Stdio serving — pumps a served surface (`{ group, handlers }`, the pair
 * `implementSurface` returns) through Effect RPC over a stdio stream pair.
 *
 * Headline API: `serveOverStdio({ group, handlers, transport })`. Default
 * transport is `process.stdin` / `process.stdout` (the subprocess-agent case);
 * loopback consumers pass the `server` half of a `LoopbackPair`.
 *
 * (The module keeps its `peer-server` filename and `@kolu/surface/peer-server`
 * subpath for this wave only — the oRPC "peer" protocol it was named after is
 * gone; renaming the file means moving the package export and every consumer
 * import, which W4 does when it touches those consumers anyway.)
 *
 * ## Serialization
 *
 * ndjson (`RpcSerialization.layerNdjson`) — the same frames the socket legs
 * emit, which is what lets a daemon splice bytes between a stdio leg and a
 * unix-socket leg without understanding them (review #10, pinned by
 * `byteSplice.test.ts`). The base64+newline codec is deleted with the peer
 * protocol.
 *
 * ## Stdout IS the protocol channel
 *
 * In an agent process that calls `serveOverStdio()` with no `transport`
 * override, `process.stdout` is the wire. Any extraneous write to stdout — a
 * stray `console.log`, a pino log line, anything — corrupts the frame the
 * client is mid-way through parsing. **Defensive measure**: when `transport` is
 * unset — the one and only discriminant, the same construction-time flag that
 * drives the Lifetime section below; there is no argv or TTY detection — this
 * module preemptively redirects `console.log` to `process.stderr`. Consumers
 * that use third-party loggers (pino, etc.) must still configure them to fd 2
 * themselves. Non-agent contexts (tests using a `LoopbackPair`, unix-socket
 * per-peer serves) pass an explicit `transport` and are untouched.
 *
 * ## Lifetime — the process IS the agent (default transport)
 *
 * A `serveOverStdio()` call with no `transport` override is the construction
 * that means "this process exists to serve this link": when the link ends, the
 * framework tears the server down, lets the returned promise settle (so a
 * caller's synchronous post-settle cleanup still runs), then **exits the
 * process** — `0` on a clean end, `1` on a transport error. This is
 * framework-owned and has no opt-out: any live handle (a poll interval, a
 * watcher) would otherwise keep the event loop alive after the link died and
 * leave an invisible immortal orphan on someone else's machine (drishti#109 —
 * ten re-parented `--stdio` agents on one fleet host). "Agent process alive,
 * link dead" is not a spellable state.
 *
 * An explicit `transport` override (loopback pairs in tests, a unix-socket
 * connection, any embedded peer): the promise resolves with how serving ended
 * and the **caller** owns the process lifetime. (The `reason` classification
 * itself — including benign write deaths reading as `"end"`, see
 * {@link ServeOverStdioEnd} — is arm-independent; only lifetime ownership
 * differs between the arms.)
 *
 * Post-settle work on the default arm: everything reachable from the settled
 * promise's microtask cascade completes before the exit, which is scheduled
 * behind it with `setImmediate`.
 *
 * ## Deferred heartbeat
 *
 * `serveOverStdio` starts no heartbeat: the agent doesn't know who its clients
 * are; the client knows whether *its* link is healthy. Clients that need one
 * layer it on top of the link, and MUST defer the first beat until after the
 * first real RPC round-trips (lesson #6).
 */

import type { Readable, Writable } from "node:stream";
import * as NodeSink from "@effect/platform-node/NodeSink";
import * as NodeStream from "@effect/platform-node/NodeStream";
import { Effect, Exit, Layer, Scope, Stdio, Stream } from "effect";
import { type PlatformError, systemError } from "effect/PlatformError";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import type { SurfaceHandlers } from "./server";

/** Transport override for `serveOverStdio`. Default is `process.stdin` for
 *  `read` and `process.stdout` for `write`. */
export interface StdioTransport {
  read: Readable;
  write: Writable;
}

/** How a `serveOverStdio` call ended. `serveOverStdio` NEVER rejects — serving
 *  ends when the transport does, and both ways it does so are ordinary
 *  peer-lifecycle events, not exceptional states for the serving process.
 *
 *  `"end"` is clean teardown from EITHER direction: a clean EOF (the peer closed
 *  its end / the parent exited) or a benign write death (`EPIPE` /
 *  `ERR_STREAM_DESTROYED` — the peer's read side vanished mid-push).
 *  `"error"` is a genuinely abnormal death — a read error or a non-benign write
 *  failure — with the cause in `error`.
 *
 *  Rejecting on transport error was a crash footgun: a host serving many
 *  short-lived peers (`serveOverUnixSocket`'s per-connection serves) fires one
 *  of these promises per peer, and an un-`.catch()`-ed rejection from any flaky
 *  client became an unhandled rejection — fatal under
 *  `process.exit(1)`-on-unhandledRejection policies.
 *
 *  A discriminated union, so "a clean end carrying an error" and "an abnormal
 *  death with no cause" are unrepresentable. */
export type ServeOverStdioEnd =
  | { reason: "end" }
  | { reason: "error"; error: unknown };

export interface ServeOverStdioOptions {
  /** The served surface's flat `RpcGroup` — `runtime.group`. */
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Every bound member handler keyed by wire tag — `runtime.handlers`. */
  readonly handlers: SurfaceHandlers;
  /** Stream pair override. Omit for the default `process.stdin` /
   *  `process.stdout` (the subprocess-agent case). */
  readonly transport?: StdioTransport;
  /** Called once, synchronously, when the first inbound bytes arrive — the
   *  moment the link demonstrably works in both directions. A synchronous THROW
   *  from it ends serving with `{ reason: "error" }`; it must also be
   *  SYNCHRONOUS, and a thenable return is thrown loudly for the same reason
   *  (an async hook's rejection would escape the read path entirely). */
  readonly onFirstRequest?: () => void;
}

/** A peer-gone write death — the pipe's far end vanished. Clean teardown, not
 *  an error: on a parent death a pushing agent often sees stdout-EPIPE before
 *  stdin delivers EOF, and carrying that race as an error would
 *  nondeterministically flip the same teardown between exit 0 and exit 1 (which
 *  ssh propagates to `Restart=on-failure` units and CI wrappers). */
function isBenignWriteError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

/** The `Stdio` service Effect's stdio protocol reads and writes through, bound
 *  to THIS transport rather than to the process. Two deliberate departures from
 *  `NodeStdio.layer`:
 *
 *  - the inbound stream SWALLOWS its own failure and ends instead, because the
 *    protocol's read loop retries a failing stdin forever (500ms spaced) and
 *    would spin against a destroyed stream; the death is classified once, by
 *    the watcher in {@link serveOverStdio}, which is the single source of truth
 *    for `reason`;
 *  - `stderr` stays the process's, so an agent's diagnostics are never mixed
 *    into the wire whatever the transport is. */
function stdioLayer(
  transport: StdioTransport,
  onFirstBytes: (() => void) | undefined,
): Layer.Layer<Stdio.Stdio> {
  const inbound = NodeStream.fromReadable<Uint8Array, PlatformError>({
    evaluate: () => transport.read,
    onError: (cause) =>
      systemError({
        module: "Stdio",
        method: "stdin",
        _tag: "Unknown",
        cause,
      }),
    closeOnDone: false,
  }).pipe(
    onFirstBytes === undefined
      ? (self) => self
      : (self) => {
          let seen = false;
          // A THROW from the hook must stop the stream BEFORE the chunk it
          // rode in on is dispatched — otherwise the failing serve still
          // answers that one request (the #1859 zombie: dead by accounting,
          // alive by socket). `Stream.catchCause` below turns the resulting
          // defect into a clean end of the inbound stream.
          return Stream.tap(self, () =>
            Effect.sync(() => {
              if (seen) return;
              seen = true;
              onFirstBytes();
            }),
          );
        },
    Stream.catchCause(() => Stream.empty),
  );

  return Layer.succeed(Stdio.Stdio)(
    Stdio.make({
      args: Effect.sync(() => process.argv.slice(2)),
      stdout: (options) =>
        NodeSink.fromWritable({
          evaluate: () => transport.write,
          onError: (cause) =>
            systemError({
              module: "Stdio",
              method: "stdout",
              _tag: "Unknown",
              cause,
            }),
          endOnDone: options?.endOnDone ?? false,
        }),
      stderr: (options) =>
        NodeSink.fromWritable({
          evaluate: () => process.stderr,
          onError: (cause) =>
            systemError({
              module: "Stdio",
              method: "stderr",
              _tag: "Unknown",
              cause,
            }),
          endOnDone: options?.endOnDone ?? false,
        }),
      stdin: inbound,
    }),
  );
}

/** Serve `handlers` over a stdio transport. Resolves when the transport ends —
 *  with HOW it ended, never a rejection (see {@link ServeOverStdioEnd}); the
 *  returned Promise is long-lived for the lifetime of the agent process.
 *
 *  Lifetime is selected by construction (see "Lifetime" in the header): with no
 *  `transport` override the process IS the agent and the framework exits it
 *  after the promise settles (`0` on `"end"`, `1` on `"error"`); with an
 *  explicit `transport` the caller owns the process lifetime. */
export function serveOverStdio(
  opts: ServeOverStdioOptions,
): Promise<ServeOverStdioEnd> {
  const transport: StdioTransport = opts.transport ?? {
    read: process.stdin,
    write: process.stdout,
  };
  // The construction-time discriminant (see "Lifetime" in the header): no
  // transport override ⇒ this process IS the agent. Two consequences hang off
  // it — we own stdout (the console.log redirect) and we own the process
  // lifetime (the exit fork at the bottom).
  const processIsTheAgent = opts.transport === undefined;

  if (processIsTheAgent) {
    const origLog = console.log.bind(console);
    console.log = (...args: unknown[]) => {
      process.stderr.write(`${args.map((a) => String(a)).join(" ")}\n`);
    };
    // Keep a reference so a consumer with a specific diagnostic need can still
    // reach the original.
    (console as unknown as { logToStderr: typeof origLog }).logToStderr =
      origLog;
  }

  let settleEnd: (end: ServeOverStdioEnd) => void = () => {};
  const classified = new Promise<ServeOverStdioEnd>((resolve) => {
    settleEnd = resolve;
  });

  // THE one classification point — every death, every shape, both directions,
  // flows through here, and the first verdict wins. A benign peer-gone write
  // death reads as a clean end (see `isBenignWriteError`); everything else that
  // is not an ordinary EOF is an error carrying its cause.
  let classifiedOnce = false;
  const finish = (end: ServeOverStdioEnd): void => {
    if (classifiedOnce) return;
    classifiedOnce = true;
    settleEnd(end);
  };

  const onFirstRequest = opts.onFirstRequest;
  const firstBytes =
    onFirstRequest === undefined
      ? undefined
      : () => {
          // `onFirstRequest` is declared `() => void` and documented
          // synchronous, but TS's void-return compatibility lets an `async
          // () => {…}` satisfy that type. An async hook's rejection would
          // escape this synchronous path entirely — an unhandled rejection,
          // the crash footgun this module eliminates everywhere else — so a
          // thenable return is thrown LOUDLY, routing it through the same
          // classified arm a synchronous throw takes.
          try {
            const result: unknown = onFirstRequest();
            if (
              result != null &&
              typeof (result as { then?: unknown }).then === "function"
            ) {
              throw new Error(
                "onFirstRequest must be synchronous: it returned a thenable. An async onFirstRequest's rejection would escape the serve loop rather than settling { reason: 'error' }.",
              );
            }
          } catch (error) {
            finish({ reason: "error", error });
            if (!transport.read.destroyed) transport.read.destroy();
            // Rethrow so the inbound stream dies HERE, before this chunk is
            // dispatched to a handler (see `stdioLayer`).
            throw error;
          }
        };

  // Read side: EOF and 'close' are clean; an error is classified. ('error'
  // always precedes 'close', and the first verdict wins.)
  transport.read.on("end", () => finish({ reason: "end" }));
  transport.read.on("close", () => finish({ reason: "end" }));
  transport.read.on("error", (error: unknown) =>
    finish(
      isBenignWriteError(error)
        ? { reason: "end" }
        : { reason: "error", error },
    ),
  );
  // Write side: an unhandled 'error' event is a hard process crash, so it is
  // always listened for. A write death means the peer's read side is gone —
  // serving is over either way; only the CLASSIFICATION differs. 'close'
  // covers the shape that emits no event at all: `destroy()` with no error,
  // where a later write fails only through its callback.
  transport.write.on("error", (error: unknown) =>
    finish(
      isBenignWriteError(error)
        ? { reason: "end" }
        : { reason: "error", error },
    ),
  );
  transport.write.on("close", () => finish({ reason: "end" }));

  const scope = Scope.makeUnsafe();
  const layer = RpcServer.layer(opts.group).pipe(
    Layer.provide(opts.group.toLayer(opts.handlers as never)),
    Layer.provide(RpcServer.layerProtocolStdio),
    Layer.provide(RpcSerialization.layerNdjson),
    Layer.provide(stdioLayer(transport, firstBytes)),
  );

  const settled: Promise<ServeOverStdioEnd> = Effect.runPromise(
    Scope.provide(Layer.build(layer), scope),
  )
    .then(
      () => classified,
      // A build failure is a serving failure — there is no half-served state.
      (error: unknown): ServeOverStdioEnd => ({ reason: "error", error }),
    )
    .then(async (end) => {
      // Teardown, as a fulfilled-only stage: releasing the scope stops the
      // protocol fibers and finalizes every in-flight handler's subscriptions.
      // Guarded, because `serveOverStdio` never rejects — that contract is
      // load-bearing for the exit fork below and for every caller.
      try {
        await Effect.runPromise(Scope.close(scope, Exit.void));
      } catch (err) {
        process.stderr.write(
          `[@kolu/surface/peer-server] teardown failed: ${(err as Error).message}\n`,
        );
      }
      return end;
    });

  if (processIsTheAgent) {
    // Framework-owned exit (see "Lifetime" in the header): the layer that saw
    // the link die is the only one that can guarantee the process dies with it
    // — the app's `main` cannot know what else holds the event loop (that
    // unknowability is exactly what made the drishti#109 orphans invisible).
    // `setImmediate` is load-bearing: it fires only after the ENTIRE microtask
    // cascade from the settle drains, so every caller continuation completes
    // first.
    void settled.then((end) => {
      setImmediate(() => {
        process.exit(end.reason === "end" ? 0 : 1);
      });
    });
  }

  return settled;
}
