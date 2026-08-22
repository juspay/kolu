/**
 * Shared internals for the **wire** links — every link that crosses a
 * transport (`websocketLink`, `stdioLink`, `unixSocketLink`). The in-process
 * `directLink` is deliberately NOT built here: it has no transport, no
 * protocol layer and no scope, so it neither needs this machinery nor may
 * inherit the half-open brand.
 *
 * ONE job: turn an Effect RPC **protocol layer** into the transport-neutral
 * {@link SurfaceDispatch} the client face consumes (`../link.ts` — the seam
 * both W2 stages compile against), owning the scope that keeps the protocol's
 * fibers alive and handing back the `dispose` that releases it.
 *
 * Package-internal (not exported through any `@kolu/surface/*` subpath).
 *
 * ## What this file deliberately does NOT do
 *
 * - **No retry fence.** PLAN D3 / review #12: `retryTransientErrors` does not
 *   resurrect in-flight calls, so the per-subscription re-subscribe fence is
 *   the FACE's job, layered on top of the raw `Stream` this dispatch returns.
 *   A link that retried internally would hide the failure the fence must see.
 * - **No typing of members.** The group is assembled by a runtime spec walk,
 *   so a flat client over `RpcGroup<Rpc.Any>` carries no trustworthy per-tag
 *   types (review #16). Precision lives in the face's spec-derived types; here
 *   the dispatch is erased, exactly as `SurfaceDispatch` declares.
 */

import type { Duplex } from "node:stream";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import {
  Cause,
  Effect,
  Exit,
  Layer,
  Result,
  Schedule,
  Scope,
  Stream,
} from "effect";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import { RpcClient } from "effect/unstable/rpc";
import { rpcSerializationLayer } from "../frameLimit";
import { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { Socket } from "effect/unstable/socket";
import { SurfaceStdioTransportClosed } from "../errors";
import { brandHalfOpenDispatch, type SurfaceDispatch } from "../link";

/** The retry schedule for a link bound to one stream pair: halt on the first
 *  failure. Not a policy knob — a re-dial would re-acquire the SAME dead fds,
 *  so the only honest schedule is "never".
 *
 *  MEASURED, not assumed (`stdioPingStall.test.ts`): flipping this to
 *  `retryTransientErrors: true` + a spaced schedule — the obvious "let a slow
 *  peer recover" fix, and the one the WEBSOCKET leg really does take — does not
 *  work here and cannot. `fromDuplex` acquires the duplex inside the socket
 *  RUN's scope, whose finaliser destroys it when the run ends; the retry then
 *  re-acquires that destroyed duplex and dies on its first write. The stall test
 *  fails either way, only with a less honest error (`SocketWriteError`). Anyone
 *  reaching for that flag here should re-run that test first. */
const neverReconnect: Schedule.Schedule<number, Socket.SocketError> =
  Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<Socket.SocketError>) =>
      Cause.done(meta.attempt),
    ),
  );

/** What every wire link factory returns: the dispatch the face binds against,
 *  plus the release of the scope the link opened. `dispose` is idempotent and
 *  is the ONLY way a link's protocol fibers (dialing, ping/pong, response
 *  pump) are released — a link that is dropped without it leaks them. */
export interface WireLink {
  /** The branded, half-openable dispatch (see `../link.ts`). */
  readonly dispatch: SurfaceDispatch;
  /** Release the link's scope: interrupt the protocol fibers and close the
   *  transport. Idempotent; after it, every call fails fast with the leg's own
   *  transport error rather than parking on a dead protocol. */
  dispose(): Promise<void>;
}

/** Why the TRANSPORT (never a member's declared error) failed a call — the
 *  input to a leg's error vocabulary. `disposed` is not an `RpcClientError`
 *  because no protocol produced it: the owner released the link. */
export type WireTransportFailure =
  | { readonly kind: "protocol"; readonly error: RpcClientError }
  | { readonly kind: "disposed" };

/** True for the transport failure channel Effect RPC unions into EVERY call
 *  (socket open/close/read/write, protocol decode defects) — as opposed to a
 *  member's DECLARED tagged error, which must reach the caller untouched. */
export function isRpcClientError(error: unknown): error is RpcClientError {
  return error instanceof RpcClientError;
}

/** The erased flat dispatch fn `RpcClient.make(group, { flatten: true })`
 *  returns for a dynamically assembled group. `RpcClient.Flat` resolves its
 *  per-tag payload/success types by matching the tag against the group's Rpc
 *  union — which, for the `Rpc.Any`-erased group `defineSurface` mints, yields
 *  `never`. So the honest local type is this one, and precision stays where
 *  review #16 put it: in the face's spec-derived types. */
type FlatDispatch = (
  tag: string,
  payload: unknown,
  // biome-ignore lint/suspicious/noExplicitAny: the return is Effect for a unary tag and Stream for a streaming one — a distinction only the spec knows, which is exactly why `SurfaceDispatch` splits `unary` from `stream` at this seam.
) => any;

/** Build a wire link over `protocol`.
 *
 *  `transportError` is the leg's error vocabulary (D4): whenever the transport
 *  channel fails — including a call issued after {@link WireLink.dispose} — the
 *  raw `RpcClientError` is replaced by whatever this returns. The stdio/unix
 *  legs mint `SurfaceStdioTransportClosed`; the websocket leg mints
 *  `SurfaceTransportRetired` once its terminal-close classifier has fired and
 *  otherwise passes the `RpcClientError` through, because THAT is the shape the
 *  face's retry fence retries on. Returning the error unchanged is therefore a
 *  legitimate answer, not a no-op. */
export async function openWireLink(opts: {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly protocol: Layer.Layer<RpcClient.Protocol, never, never>;
  readonly transportError: (failure: WireTransportFailure) => unknown;
}): Promise<WireLink> {
  // The link's own scope. It outlives `openWireLink` by construction — the
  // protocol layer forks its dial/ping/pump fibers INTO it — which is why the
  // layer cannot be provided with `Effect.provide` (that scopes the build to
  // the effect that consumes it, tearing the transport down the instant the
  // client is constructed).
  const scope = Scope.makeUnsafe();

  const client: FlatDispatch = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(opts.protocol);
      return yield* Effect.provideContext(
        RpcClient.make(opts.group, { flatten: true }),
        context,
      );
    }).pipe(Scope.provide(scope)) as Effect.Effect<FlatDispatch>,
  );

  let disposed = false;
  const disposedError = () =>
    opts.transportError({ kind: "disposed" }) as unknown;

  /** Translate a call's cause into the leg's vocabulary. Three kinds arrive
   *  here and exactly one is ours:
   *
   *  - a FAILURE carrying `RpcClientError` — the transport channel: mapped.
   *  - a DEFECT carrying `Socket.SocketError` — also the transport channel,
   *    only arriving as a defect because Effect's socket protocol `orDie`s a
   *    failed WRITE. A send that dies because the pipe is gone is a transport
   *    death like any other, so it is normalised into the same
   *    `RpcClientError` shape rather than escaping as a defect that no
   *    consumer can narrow (it would crash a Promise-edge caller instead of
   *    failing its call).
   *  - anything else — a member's DECLARED tagged error, an undeclared
   *    handler defect, an interrupt: passed through UNTOUCHED (D4). */
  const rescue = (cause: Cause.Cause<unknown>): Cause.Cause<unknown> => {
    const failure = Cause.findError(cause);
    if (Result.isSuccess(failure)) {
      return isRpcClientError(failure.success)
        ? Cause.fail(
            opts.transportError({ kind: "protocol", error: failure.success }),
          )
        : cause;
    }
    const defect = Cause.findDefect(cause);
    if (Result.isSuccess(defect) && Socket.isSocketError(defect.success)) {
      return Cause.fail(
        opts.transportError({
          kind: "protocol",
          error: new RpcClientError({ reason: defect.success.reason }),
        }),
      );
    }
    return cause;
  };

  const dispatch: SurfaceDispatch = brandHalfOpenDispatch({
    unary: (tag: string, payload: unknown) =>
      Effect.suspend(
        (): Effect.Effect<unknown, unknown> =>
          disposed ? Effect.fail(disposedError()) : client(tag, payload),
      ).pipe(Effect.catchCause((cause) => Effect.failCause(rescue(cause)))),
    stream: (tag: string, payload: unknown) =>
      Stream.unwrap(
        Effect.suspend(
          (): Effect.Effect<Stream.Stream<unknown, unknown>> =>
            disposed
              ? Effect.succeed(Stream.fail(disposedError()))
              : Effect.succeed(client(tag, payload)),
        ),
      ).pipe(Stream.catchCause((cause) => Stream.failCause(rescue(cause)))),
  });

  return {
    dispatch,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}

/** Build a wire link over an already-open Node `Duplex` — the ONE place the
 *  stdio and unix-socket legs share, so their framing, their retry schedule and
 *  their error vocabulary cannot drift (which is the whole basis of the
 *  byte-splice guarantee, review #10).
 *
 *  `describe` names the transport in the `SurfaceStdioTransportClosed` reason,
 *  because that string is what an operator reads when a daemon vanishes.
 *
 *  **Package-internal, and that is load-bearing** (juspay/kolu#2101). This is
 *  the raw attach: it builds the protocol layer — and with it Effect RPC's
 *  pinger — over whatever duplex it is handed, with no proof that the far end is
 *  of this protocol epoch. Every PUBLIC way to reach it must therefore carry its
 *  own epoch argument: `stdioLink` demands a `StdioReadinessProof`,
 *  `socketDuplexLink` is a documented local-rendezvous residual, and
 *  `unixSocketLink` is the same rendezvous by another spelling. Exporting this
 *  body through a subpath would restore the blind attach the gate abolishes,
 *  which is why it moved out of `./stdio` (an exported subpath) and into this
 *  file (which is not one). */
export async function duplexWireLink(opts: {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly duplex: Duplex;
  readonly describe: string;
}): Promise<WireLink> {
  // A destroyed pipe emits 'error' on the stream, and an 'error' with no
  // listener is a hard process crash — not a rejection a consumer can catch.
  // Effect's socket attaches its own listeners only WHILE running, so this
  // permanent one covers the windows either side (an EPIPE felled a
  // consumer's coordinator on teardown before the oRPC-era link grew the same
  // guard). The transport death itself is handled by the socket run failing.
  opts.duplex.on("error", () => {});

  const socket = await Effect.runPromise(
    NodeSocket.fromDuplex(
      Effect.acquireRelease(Effect.succeed(opts.duplex), (duplex) =>
        Effect.sync(() => {
          if (!duplex.destroyed) duplex.destroy();
        }),
      ),
    ),
  );

  const protocol = Layer.effect(RpcClient.Protocol)(
    RpcClient.makeProtocolSocket({ retryPolicy: neverReconnect }),
  ).pipe(
    Layer.provide([
      Layer.succeed(Socket.Socket)(socket),
      rpcSerializationLayer,
    ]),
  );

  /**
   * Did this link die because the PEER WENT QUIET, rather than because the pipe
   * broke? Effect RPC spells those two with the same word, and here — and ONLY
   * here — one of the two readings is impossible.
   *
   * `SocketOpenError{kind:"Timeout"}` has exactly two producers in Effect: a
   * socket's `openTimeout` (a DIAL that never opened) and
   * `makeProtocolSocket`'s own pinger (`makePinger` — a ping every 5s, and the
   * run ends the moment a tick finds the previous ping unanswered). This
   * function is a CLOSURE inside `duplexWireLink`, and that is load-bearing
   * rather than tidiness: the reading below is true only because of how the
   * socket three lines up was built — `fromDuplex` over an ALREADY-OPEN
   * `Duplex`, with no `openTimeout` — so there is no dial on this leg to time
   * out. Every public door into this function (`stdioLink`, `socketDuplexLink`,
   * `unixSocketLink`) hands over an already-open duplex, and the function is
   * package-internal, so that enumeration is closed.
   *
   * At module scope it would be one import away from `openWireLink`'s OTHER
   * caller — the websocket leg, whose socket comes from `Socket.makeWebSocket`
   * and DOES apply `openTimeout ?? 10000`, minting the identical shape for a
   * dial that genuinely never opened. Same predicate, opposite meaning. The
   * scope is the proof; a comment would not be.
   *
   * Why bother: `SocketOpenError`'s own `message` getter renders the fixed
   * string `timeout waiting for "open"` for both, so an established link whose
   * peer merely got busy reported itself, verbatim, as a socket that never
   * opened — under a suffix asserting "the peer process exited". Every word of
   * that was wrong, and the wrongness is expensive: juspay/kolu#2101 burned an
   * incident on a log line "indistinguishable from an unreachable box", and a
   * later production stall (a 16-core box at load 67, its agent alive
   * throughout and demonstrably serving a request 79ms after we declared it
   * dead) was read the same way again. `heartbeat.ts`, this framework's own
   * watchdog, is suspension-aware and would have deferred — but it never gets a
   * vote, because Effect's 5s pinger is hardcoded and always fires first.
   *
   * We cannot move that deadline (`makeProtocolSocket` exposes no ping cadence)
   * and cannot retry through it (see {@link neverReconnect}). Naming the fact
   * correctly is what is left.
   */
  const keepAliveWentUnanswered = (error: RpcClientError): boolean =>
    error.reason._tag === "SocketOpenError" && error.reason.kind === "Timeout";

  return openWireLink({
    group: opts.group,
    protocol,
    transportError: (failure) =>
      new SurfaceStdioTransportClosed({
        reason:
          failure.kind === "disposed"
            ? `${opts.describe} link disposed; request not sent`
            : keepAliveWentUnanswered(failure.error)
              ? // `describe` names the TRANSPORT (a binary on a host, a socket
                // path, "loopback"), so the peer gets its own noun — a socket
                // path cannot be the thing that stopped answering.
                `the peer on ${opts.describe} stopped answering the keep-alive ping, so the link was dropped. It may still be ALIVE and merely too busy to answer within the ping deadline — this is not evidence that it exited.`
              : `${opts.describe} transport closed (${failure.error.message}); the peer process exited or its stream ended`,
      }),
  });
}
