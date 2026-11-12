/**
 * The workaround for ONE Effect RPC client hazard — kept in this module, apart
 * from the wire links' own vocabulary, because it changes on Effect's clock and
 * not on ours. This header is the canonical account; everything else that
 * mentions the hazard points here.
 *
 * THE HAZARD (effect@4.1.4, `rpc/RpcClient.ts`). Every stream on a link shares
 * one socket reader. `makeProtocolSocket`'s read loop hands each decoded response
 * to the client strictly in sequence, and the client delivers a stream `Chunk`
 * with `Queue.offerAll` into that stream's BOUNDED queue (16) — then sends the
 * `Ack`. So a consumer that stops pulling fills its queue, the offer suspends,
 * and the READER suspends with it: no other stream, no unary answer and no
 * frame of any kind is read until that one consumer moves: every other stream
 * and call on the link waits on one stalled consumer, and once no frame has
 * been decoded for the keep-alive's window (`../keepAlive.ts`) the link's own
 * pinger ends it, with the peer healthy throughout.
 *
 * THE WORKAROUND. {@link decoupleDelivery} wraps the client `Protocol` so each
 * request's responses drain through their own in-order LANE and the reader moves
 * on at once. The `Ack` still goes out only after the offer lands, so per-stream
 * backpressure is unchanged: a stalled consumer holds up its own stream, its
 * sender waits, and it resumes where it left off.
 *
 * THE COST (measured for kolu#2352, against the same tree with lanes bypassed):
 * one fiber fork per chunk, because a lane a keeping-up consumer drains is
 * empty again after every delivery. That is +4 to +7 µs CPU per 200 B chunk and
 * 17–26% fewer small chunks/s at the link's ceiling; 256 KiB chunks are
 * unchanged. Only Effect's client can avoid it (try the offer, fork only when
 * the queue is full).
 *
 * DELETE THIS MODULE when Effect's client stops delivering on its reader. Its
 * one call site is the protocol wrap in `openWireLink` (`./wire.ts`).
 * `streamConsumerStall.test.ts` is the measure either way.
 *
 * BETA-ASSUMPTION(4.1.4): a stream Chunk is the only response whose delivery waits on a consumer, a delivery fails only when interrupted, and a stream's own finaliser shuts its queue down.
 * In effect@4.1.4 `RpcClient.make`'s `write` offers a `Chunk` into the stream's
 * bounded queue and Acks after (not when the offer was dropped); `Exit` ends a
 * queue or resumes a call; `Defect`/`ClientProtocolError` fail entries. The
 * `run` handler writes an undecodable chunk as its request's `Exit` and then
 * swallows the failure, re-raising only an interrupt. `onStreamRequest`'s scope
 * finaliser calls `Queue.shutdownUnsafe`, which resumes an offer parked on the
 * queue — so a lane never outlives its consumer without help from here. A
 * regression in any of it brings back the starved reader, a stream that loses
 * frames, a lane parked on a torn-down consumer, or a delivery failure that
 * never reaches its consumer — each a case in `streamConsumerStall.test.ts`.
 */
import { Effect, type Scope } from "effect";
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
          // The interrupt path (the link's scope closing mid-delivery): the
          // lane goes too, so later frames for it queue behind nobody.
          Effect.onError(() => Effect.sync(() => lanes.delete(requestId))),
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
