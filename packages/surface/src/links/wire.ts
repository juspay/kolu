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
 * The machinery here is package-internal. The `@kolu/surface/links/wire`
 * subpath exists for ONE reason: this file is the canonical account of Effect's
 * pinger, so {@link RPC_PING_INTERVAL_MS} / {@link RPC_PING_FATAL_SILENCE_MS}
 * are readable by the tests elsewhere that reason about link silence, instead of
 * being transcribed from this prose into a local literal.
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
  Context,
  Effect,
  Exit,
  Layer,
  Queue,
  Result,
  Schedule,
  Scope,
  Stream,
} from "effect";
import type { Rpc, RpcGroup } from "effect/rpc";
import { RpcClient } from "effect/rpc";
import type { FromServerEncoded } from "effect/rpc/RpcMessage";
import { rpcSerializationLayer } from "../frameLimit";
import { RpcClientError } from "effect/rpc/RpcClientError";
import { Socket } from "effect/socket";
import { SurfaceStdioTransportClosed } from "../errors";
import { RPC_PING_FATAL_SILENCE_MS, RPC_PING_INTERVAL_MS } from "../keepAlive";
import { brandHalfOpenDispatch, type SurfaceDispatch } from "../link";

/** How often `RpcClient.makeProtocolSocket`'s own pinger writes a ping, and the
 *  worst-case silence it tolerates before ending the socket run — Effect's
 *  numbers, OBSERVED, not knobs we own. Re-exported from `../keepAlive` (the
 *  leaflet that owns them) so this subpath's importers keep one import path;
 *  the canonical account of the MECHANISM is `keepAliveWentUnanswered` below. */
export { RPC_PING_FATAL_SILENCE_MS, RPC_PING_INTERVAL_MS };

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
  options?: { readonly asQueue?: boolean },
  // biome-ignore lint/suspicious/noExplicitAny: the return is Effect for a unary tag and Stream for a streaming one (or, with `asQueue`, a scoped Effect of the stream's Queue) — a distinction only the spec knows, which is exactly why `SurfaceDispatch` splits `unary` from `stream` at this seam.
) => any;

/** Wrap a client `Protocol` so that delivering a response NEVER blocks the
 *  socket reader.
 *
 *  THE HAZARD (effect@4.0.0, `RpcClient.ts`). `makeProtocolSocket`'s read loop
 *  hands each decoded response to the client strictly in sequence, and the
 *  client delivers a stream `Chunk` with `Queue.offerAll` into that stream's
 *  BOUNDED queue (16) — then sends the `Ack`. So a consumer that stops pulling
 *  fills its queue, the offer suspends, and the READER suspends with it: no other
 *  stream, no unary answer, and no `Pong` is read until that one consumer moves.
 *  Effect's pinger then ends the link 5–10 s later with the peer healthy
 *  throughout. Worse, a consumer that is torn down while full leaves the offer
 *  parked on an orphaned queue — Effect's interrupt finaliser deletes the entry
 *  and tells the server, but never releases the queue — so the reader is gone
 *  for good.
 *
 *  THE FIX. Each request's `Chunk`/`Exit` responses are handed to a per-request
 *  LANE — an in-order mailbox drained by its own fiber in the link's scope — and
 *  the reader moves on at once. Order within a request is preserved (one lane,
 *  one drainer); the `Ack` still goes out only after the offer lands, so
 *  per-stream BACKPRESSURE is unchanged: a consumer that stops pulling holds up
 *  its own stream and nothing else, and resumes where it left off. What a lane
 *  must not do is outlive its consumer, and that is {@link openWireLink}'s
 *  stream dispatch's job: it shuts the queue down when the subscription ends,
 *  which resumes a parked offer.
 *
 *  THE LANE'S BOUND IS THE ACK, AND IT IS ENFORCED. A peer that waits for each
 *  `Ack` sends at most one chunk per stream ahead of its consumer, so a lane
 *  holds at most that chunk plus the `Exit` behind it. Against a protocol
 *  without acks the lane would be an unbounded buffer, so such a protocol is
 *  REFUSED here, when the link is built — not discovered later as memory.
 *
 *  An `Exit` with no lane ahead of it, and every non-request response (`Defect`,
 *  `ClientProtocolError`), is delivered INLINE: those end a queue or resume a
 *  waiting call and never wait on a consumer.
 *
 *  BETA-ASSUMPTION(4.0.0): a stream Chunk is the only response whose delivery waits on a consumer, and a failed delivery has already been written as its request's Exit.
 *  In effect@4.0.0 `RpcClient.make`'s `write` offers a `Chunk` into the
 *  stream's bounded queue and Acks after; `Exit` ends a queue or resumes a
 *  call; `Defect`/`ClientProtocolError` fail entries. The `run` handler wraps a
 *  chunk's decode-and-offer in `Effect.onError` that writes the request's `Exit`
 *  before the failure re-raises, and `asQueue: true` registers the request's
 *  interrupt finaliser on the Scope it runs in and hands back the queue
 *  {@link openWireLink} shuts down. `streamConsumerStall.test.ts` measures the
 *  contract: a regression in any of it brings back the starved reader, a stream
 *  that loses frames, or a delivery failure that never reaches its consumer. */
function decoupleDelivery(
  inner: RpcClient.Protocol["Service"],
  scope: Scope.Scope,
): RpcClient.Protocol["Service"] {
  if (inner.supportsAck !== true) {
    throw new Error(
      "openWireLink: the client protocol does not support acks — a per-request delivery lane is only bounded because the peer waits for each stream chunk's Ack, so a protocol without them would make every lane an unbounded buffer",
    );
  }
  return {
    ...inner,
    run: (clientId, deliver) => {
      const lanes = new Map<string | number, Array<FromServerEncoded>>();
      const drain = (requestId: string | number, lane: FromServerEncoded[]) =>
        Effect.gen(function* () {
          // The head stays IN the lane while it is delivered, so a response that
          // arrives meanwhile queues behind it instead of opening a second lane.
          while (lane.length > 0) {
            yield* deliver(lane[0] as FromServerEncoded);
            lane.shift();
          }
        }).pipe(
          // UNCONDITIONAL, so a lane can never outlive its drainer and leave
          // later frames for its request queued behind nobody.
          Effect.ensuring(Effect.sync(() => lanes.delete(requestId))),
          // A delivery that FAILS (a chunk the client cannot decode) has
          // already reached its consumer: Effect's handler writes the failure
          // as the request's own `Exit` — the stream fails with it — before
          // re-raising (BETA-ASSUMPTION above, measured). Re-raising it here
          // would only fail this detached fiber, where nobody observes it; the
          // request is over and the rest of its lane is moot. One undecodable
          // chunk therefore costs its own stream, never the link.
          Effect.exit,
        );
      return inner.run(clientId, (message) => {
        if (message._tag !== "Chunk" && message._tag !== "Exit") {
          return deliver(message);
        }
        const lane = lanes.get(message.requestId);
        if (lane !== undefined) {
          lane.push(message);
          return Effect.void;
        }
        if (message._tag === "Exit") return deliver(message);
        const fresh: FromServerEncoded[] = [message];
        lanes.set(message.requestId, fresh);
        return Effect.asVoid(
          Effect.forkIn(drain(message.requestId, fresh), scope),
        );
      });
    },
  };
}

/** Build a wire link over `protocol`.
 *
 *  `transportError` is the leg's READING of a transport death (D4): whenever the
 *  transport channel fails, the raw `RpcClientError` is replaced by whatever this
 *  returns. The stdio/unix legs mint `SurfaceStdioTransportClosed`; the websocket
 *  leg mints `SurfaceTransportRetired` once its terminal-close classifier has
 *  fired and otherwise passes the `RpcClientError` through, because THAT is the
 *  shape the face's retry fence retries on. Returning the error unchanged is
 *  therefore a legitimate answer, not a no-op.
 *
 *  `disposedError` is the OTHER channel, and it is split out because it is not a
 *  reading of anything: a call issued after {@link WireLink.dispose} never
 *  reached a protocol, so no transport reported. THIS function owns that fact —
 *  it owns `dispose` — and stamps it, so a leg cannot re-derive "was it
 *  disposed?" from a `kind` field and cannot get the answer different from the
 *  bookkeeping that decided it. The leg supplies only the value, because the two
 *  legs' vocabularies are different classes. */
export async function openWireLink(opts: {
  readonly group: RpcGroup.RpcGroup<Rpc.Any>;
  readonly protocol: Layer.Layer<RpcClient.Protocol, never, never>;
  readonly transportError: (error: RpcClientError) => unknown;
  readonly disposedError: () => unknown;
}): Promise<WireLink> {
  // The link's own scope. It outlives `openWireLink` by construction — the
  // protocol layer forks its dial/ping/pump fibers INTO it — which is why the
  // layer cannot be provided with `Effect.provide` (that scopes the build to
  // the effect that consumes it, tearing the transport down the instant the
  // client is constructed).
  const scope = Scope.makeUnsafe();

  // RpcClient.Flat<Rpc.Any> gives its payload parameter type `never` because
  // ExtractTag cannot recover members from the erased group. Cast only the
  // payload at the call boundary; leave the construction Effect's
  // error/environment types checked (the face restores per-member types).
  const typedClient = await Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(opts.protocol);
      // Every leg's protocol is wrapped HERE, at the one seam they all cross,
      // so no leg can be built with a reader that a consumer can block.
      const decoupled = decoupleDelivery(
        Context.get(context, RpcClient.Protocol),
        scope,
      );
      return yield* Effect.provideContext(
        RpcClient.make(opts.group, { flatten: true }),
        Context.add(context, RpcClient.Protocol, decoupled),
      );
    }).pipe(
      Scope.provide(scope),
      // A refused build (a protocol without acks) must not leave the
      // protocol's dial/ping fibers running in a scope nobody will dispose.
      Effect.onError(() => Scope.close(scope, Exit.void)),
    ),
  );
  const client: FlatDispatch = (tag, payload, options) =>
    typedClient(tag, payload as never, options);

  let disposed = false;

  /** Open one stream over the client as its QUEUE, so the subscription can
   *  shut that queue down when it ends — completion, failure, or an
   *  interrupted consumer. Shutting down resumes an offer parked on it, which
   *  is what keeps a torn-down consumer from leaving its lane parked on an
   *  orphaned queue (Effect's own interrupt finaliser, registered on the same
   *  scope, deletes the entry and tells the server, and runs after this one). */
  const queuedStream = (
    tag: string,
    payload: unknown,
  ): Effect.Effect<Stream.Stream<unknown, unknown>, never, Scope.Scope> =>
    Effect.gen(function* () {
      const queue = yield* client(tag, payload, {
        asQueue: true,
      }) as Effect.Effect<Queue.Queue<unknown, unknown>, never, Scope.Scope>;
      yield* Effect.addFinalizer(() => Queue.shutdown(queue));
      return Stream.fromQueue(queue);
    });

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
        ? Cause.fail(opts.transportError(failure.success))
        : cause;
    }
    const defect = Cause.findDefect(cause);
    if (Result.isSuccess(defect) && Socket.isSocketError(defect.success)) {
      return Cause.fail(
        opts.transportError(
          new RpcClientError({ reason: defect.success.reason }),
        ),
      );
    }
    return cause;
  };

  const dispatch: SurfaceDispatch = brandHalfOpenDispatch({
    unary: (tag: string, payload: unknown) =>
      Effect.suspend(
        (): Effect.Effect<unknown, unknown> =>
          disposed ? Effect.fail(opts.disposedError()) : client(tag, payload),
      ).pipe(Effect.catchCause((cause) => Effect.failCause(rescue(cause)))),
    stream: (tag: string, payload: unknown) =>
      Stream.unwrap(
        Effect.suspend(
          (): Effect.Effect<
            Stream.Stream<unknown, unknown>,
            never,
            Scope.Scope
          > =>
            disposed
              ? Effect.succeed(Stream.fail(opts.disposedError()))
              : queuedStream(tag, payload),
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
   * Did this link die because its keep-alive went UNANSWERED, rather than
   * because the pipe broke? This docstring is the CANONICAL account of Effect's
   * pinger for this repo — `stdioPingStall.test.ts`, `sshConnector.ts`,
   * `errors.ts` and the surface reference page each carry one sentence and a
   * pointer here, because this is the only code that acts on the fact.
   *
   * THE MECHANISM. `RpcClient.makeProtocolSocket` runs a pinger of its own:
   * `makePinger` writes a ping every 5s and ends the socket run the moment a
   * tick finds the previous ping unanswered — so 5–10s of silence is fatal, and
   * the cadence is not a knob (`makeProtocolSocket` exposes no option for it).
   * `heartbeat.ts`, this framework's own watchdog, is suspension-aware and would
   * have deferred; it never gets a vote, because the lower deadline always wins.
   * We cannot move that deadline, and we cannot retry through it (see
   * {@link neverReconnect}, where that is MEASURED). Naming the death correctly
   * is what is left.
   *
   * WHAT "UNANSWERED" MEANS — and what it does not. The pinger only sees a
   * `Pong` when THIS side's read loop reaches it, so a missing answer is a fact
   * about the reader as much as about the peer. Three things can produce it:
   *
   *   - the PEER went quiet — too busy to answer (a box at load 67), or gone
   *     silent without closing the pipe;
   *   - THIS process could not read the answer in time — its own event loop
   *     starved past the window;
   *   - (no longer) one of this link's STREAM CONSUMERS stopped pulling. Effect's
   *     reader delivers a stream chunk by offering into that stream's bounded
   *     queue, and used to park there until the consumer moved, with the `Pong`
   *     unread behind it — a healthy peer declared dead because one local
   *     subscriber stalled, and, if that subscriber was then torn down, a reader
   *     parked forever on its orphaned queue. {@link decoupleDelivery} takes
   *     delivery off the reader, so a stalled consumer now holds up only its own
   *     stream (its `Ack` is withheld, so its sender waits) and can no longer
   *     cause this death (`streamConsumerStall.test.ts` measures both shapes).
   *
   * So `keepAliveUnanswered` says the WIRE went quiet as this reader saw it: the
   * peer, or this side's ability to read it — never proof that the peer exited.
   *
   * BETA-ASSUMPTION(4.0.0): the RPC pinger fails with SocketReadError whose cause is Error("ping timeout").
   * In Effect 4.0.0, src/rpc/RpcClient.ts
   * races the read loop with the pinger and broadcasts its SocketReadError.
   * NodeSocket.fromDuplex also wraps ordinary read failures in SocketReadError,
   * so the tag alone cannot distinguish a missed heartbeat. The upstream cause
   * message is now part of this classification contract, measured by
   * stdioPingStall.test.ts alongside a real non-heartbeat read failure.
   */
  const keepAliveWentUnanswered = (error: RpcClientError): boolean =>
    error.reason._tag === "SocketReadError" &&
    error.reason.cause instanceof Error &&
    error.reason.cause.message === "ping timeout";

  const link = await openWireLink({
    group: opts.group,
    protocol,
    // The classification is DATA (`death`); `reason` is only the sentence beside
    // it. What each death means about the peer belongs to the literal's own
    // docstring in `errors.ts`, so this framework mints no operator paragraph
    // and a consumer that owns the user-facing words can brand its own.
    transportError: (error) =>
      keepAliveWentUnanswered(error)
        ? new SurfaceStdioTransportClosed({
            death: "keepAliveUnanswered",
            // `describe` is a noun phrase naming the TRANSPORT — `padi on myhost`,
            // `unix socket /run/padi.sock`, `loopback` — and none of those is
            // something a peer sits "on". So it takes the LABEL position that
            // `readiness.ts` already puts the same string in, and the peer gets
            // its own noun after the colon.
            reason: `${opts.describe}: the peer stopped answering the keep-alive ping`,
          })
        : new SurfaceStdioTransportClosed({
            death: "streamEnded",
            reason: `${opts.describe} transport closed (${error.message}); the peer process exited or its stream ended`,
          }),
    disposedError: () =>
      new SurfaceStdioTransportClosed({
        death: "disposed",
        reason: `${opts.describe} link disposed; request not sent`,
      }),
  });

  return {
    dispatch: link.dispatch,
    /** Close the protocol's scope, THEN sever the duplex this function was
     *  handed.
     *
     *  The second half is not redundant, and the case it covers is the ordinary
     *  one for a short-lived client: a link that is disposed having placed NO
     *  request. Effect's socket protocol attaches the duplex when its run
     *  starts, and the run starts with the first request — so on a
     *  dial-then-dispose the scope closes over a protocol that never attached,
     *  the `fromDuplex` release never fires, and the open descriptor keeps the
     *  process alive with nothing left to do. (A CLI that dials, answers from a
     *  hand-authored verb that touches no member, and exits, hung forever.)
     *
     *  Guarded and idempotent: when the protocol DID run, its own release has
     *  already destroyed the duplex and this is a no-op. `dispose` on
     *  `openWireLink` is itself idempotent, so calling this twice is safe. */
    dispose: async () => {
      await link.dispose();
      if (!opts.duplex.destroyed) opts.duplex.destroy();
    },
  };
}
