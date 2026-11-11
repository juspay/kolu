/**
 * The workaround for ONE Effect RPC client hazard — kept in this module, apart
 * from the wire links' own vocabulary, because it changes on Effect's clock and
 * not on ours. This header is the canonical account; everything else that
 * mentions the hazard points here.
 *
 * THE HAZARD (effect@4.0.0, `rpc/RpcClient.ts`). Every stream on a link shares
 * one socket reader. `makeProtocolSocket`'s read loop hands each decoded response
 * to the client strictly in sequence, and the client delivers a stream `Chunk`
 * with `Queue.offerAll` into that stream's BOUNDED queue (16) — then sends the
 * `Ack`. So a consumer that stops pulling fills its queue, the offer suspends,
 * and the READER suspends with it: no other stream, no unary answer, and no
 * `Pong` is read until that one consumer moves, and Effect's pinger ends the
 * link 5–10 s later with the peer healthy throughout. Worse, a consumer torn
 * down while full leaves the offer parked on an orphaned queue — Effect's
 * interrupt finaliser deletes the entry and tells the server, but never releases
 * the queue — so the reader is gone for good.
 *
 * THE WORKAROUND, in two halves:
 *
 *  - {@link decoupleDelivery} wraps the client `Protocol` so each request's
 *    responses drain through their own in-order LANE and the reader moves on at
 *    once. The `Ack` still goes out only after the offer lands, so per-stream
 *    backpressure is unchanged: a stalled consumer holds up its own stream, its
 *    sender waits, and it resumes where it left off.
 *  - {@link releasedOnEnd} shuts a stream's queue down when its subscription
 *    ends, which resumes an offer parked on it, so no lane outlives its consumer.
 *
 * DELETE THIS MODULE when Effect's client stops delivering on its reader (or
 * releases a stream's queue in the request finaliser). Its two call sites are in
 * `openWireLink` (`./wire.ts`): the protocol wrap at build, and the stream
 * dispatch — which then returns `client(tag, payload)` again, and `FlatDispatch`
 * drops its `options`. `streamConsumerStall.test.ts` is the measure either way.
 *
 * BETA-ASSUMPTION(4.0.0): a stream Chunk is the only response whose delivery waits on a consumer, and a failed delivery has already been written as its request's Exit.
 * In effect@4.0.0 `RpcClient.make`'s `write` offers a `Chunk` into the stream's
 * bounded queue and Acks after; `Exit` ends a queue or resumes a call;
 * `Defect`/`ClientProtocolError` fail entries. The `run` handler wraps a chunk's
 * decode-and-offer in `Effect.onError` that writes the request's `Exit` before
 * the failure re-raises, and `asQueue: true` registers the request's interrupt
 * finaliser on the Scope it runs in and hands back the queue. A regression in
 * any of it brings back the starved reader, a stream that loses frames, or a
 * delivery failure that never reaches its consumer — each a case in
 * `streamConsumerStall.test.ts`.
 */
import { Effect, Queue, type Scope, Stream } from "effect";
import type { RpcClient } from "effect/rpc";
import type { FromServerEncoded } from "effect/rpc/RpcMessage";

/** Wrap a client `Protocol` so delivering a response NEVER blocks its reader.
 *
 *  A lane's bound is the `Ack`: a peer that waits for each one sends at most one
 *  chunk per stream ahead of its consumer, so a lane holds that chunk plus the
 *  `Exit` behind it. Against a protocol without acks a lane would be an
 *  unbounded buffer, so such a protocol is REFUSED here, when the link is built.
 *
 *  An `Exit` with no lane ahead of it, and every non-request response
 *  (`Defect`, `ClientProtocolError`), is delivered INLINE: those end a queue or
 *  resume a waiting call and never wait on a consumer. */
export function decoupleDelivery(
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
          for (;;) {
            // The head stays IN the lane while it is delivered, so a response
            // that arrives meanwhile queues behind it instead of opening a
            // second lane.
            yield* deliver(lane[0] as FromServerEncoded);
            lane.shift();
            // INVARIANT: "the lane is empty" and "the lane is removed" are ONE
            // synchronous step — no `yield*` between the check and the delete.
            // A yield there would let the reader find the empty, still
            // registered lane and push onto it a response no drainer will ever
            // deliver (nor `Ack`), freezing the stream with no error anywhere.
            if (lane.length === 0) {
              lanes.delete(requestId);
              return;
            }
          }
        }).pipe(
          // The failure and interrupt paths, where the request is already
          // over: the lane goes too, so later frames for it queue behind nobody.
          Effect.onError(() => Effect.sync(() => lanes.delete(requestId))),
          // A delivery that FAILS (a chunk the client cannot decode) has
          // already reached its consumer as the request's own `Exit` (the
          // BETA-ASSUMPTION above). Re-raising it would only fail this detached
          // fiber, where nobody observes it, so one undecodable chunk costs its
          // own stream, never the link.
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

/** A stream over the queue `openQueue` hands back (the client's `asQueue`
 *  call), whose subscription SHUTS THAT QUEUE DOWN when it ends — completion,
 *  failure, or an interrupted consumer. Shutting down resumes an offer parked
 *  on it, so a torn-down consumer never leaves its lane parked. Effect's own
 *  interrupt finaliser is registered on the same scope and runs after this one. */
export function releasedOnEnd(
  openQueue: Effect.Effect<Queue.Queue<unknown, unknown>, never, Scope.Scope>,
): Effect.Effect<Stream.Stream<unknown, unknown>, never, Scope.Scope> {
  return Effect.gen(function* () {
    const queue = yield* openQueue;
    yield* Effect.addFinalizer(() => Queue.shutdown(queue));
    return Stream.fromQueue(queue);
  });
}
