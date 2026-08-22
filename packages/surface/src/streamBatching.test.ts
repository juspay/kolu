/**
 * A ROUND TRIP CARRIES THE BACKLOG, not one frame of it.
 *
 * `RpcServer` sends one `Chunk` frame per stream CHUNK and, on a transport that
 * acknowledges (every websocket client does), waits for the ack before sending
 * the next. So the shape of the chunks a subscription's producer emits decides
 * how much of a backlog one round trip carries — and a producer that wraps
 * every value in a chunk of its own makes every subscription stop-and-wait:
 * exactly one publish per round trip, whatever has piled up behind it.
 *
 * That is not a throughput nicety. A producer publishing faster than the round
 * trip can never be caught up with, so a consumer falls behind by
 * (publishes × RTT) and stays there. Measured on olai's chat panel over a
 * 200ms link: an answer the agent finished streaming in 10.6s took 82.6s to
 * finish arriving, with the reader watching text that had been written a
 * minute earlier (`transcript-stream-quadratic`).
 *
 * So this is a test about CHUNKS rather than about values, and it is written
 * against the property rather than the mechanism: whatever the substrate, a
 * consumer that comes back for more after N publishes must be handed all N.
 *
 * WHERE THE OTHER HALF IS PINNED, because it is not here and a reader should
 * not have to find that out. Batching means a buffer, and an UNBOUNDED buffer
 * silently retires the producer's own back-pressure: a channel that declares a
 * high-water mark and a drop policy never reaches it, because the subscription
 * drains it as fast as it fills, so the policy is dead while still being
 * declared. That is what the first attempt at this shipped (#2199, reverted in
 * #2201) and what `@kolu/surface-remote`'s `reServeSurface.test.ts` caught — its
 * mirrored cells rely on exactly that policy (drop-oldest and keep flowing,
 * never abort), so it exercises the bound end to end over a real link and is
 * the guard this file defers to rather than paraphrases. A surface-level twin
 * was written and thrown away: with the consumer parked the channel overruns on
 * the publish burst itself, so it went green with or without the bound — a
 * false guard is worse than an absent one.
 */

import { Effect, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { cell } from "./index";
import { cellHandlers, inMemoryChannel, inMemoryStore } from "./server";

/** A cell's `get` stream, over a bus this test publishes into — with the
 *  channel's own bound, when the case is about one. */
const subscription = (options: Parameters<typeof inMemoryChannel>[0] = {}) => {
  const bus = inMemoryChannel<number>(options);
  const handlers = cellHandlers(
    cell({ name: "n", schema: Schema.Number, default: 0 }),
    { store: inMemoryStore(0), bus },
  );
  return { bus, stream: handlers.get() };
};

/** Let the drain's pending pulls and the channel's own hops settle. */
const settle = () => new Promise((done) => setTimeout(done, 20));

describe("what one pull carries", () => {
  it("hands over everything published while the consumer was away", async () => {
    const { bus, stream } = subscription();
    const chunks: number[][] = [];
    // A consumer that goes away between chunks — which is what an ACKing
    // transport is: it takes a chunk, sends it, and comes back when the far
    // end says it arrived.
    const reading = Effect.runFork(
      Stream.runForEachArray(stream, (values) =>
        Effect.promise(async () => {
          chunks.push([...values]);
          await settle();
        }),
      ),
    );

    // The snapshot lands first and on its own — it is published before
    // anything else exists to batch with.
    await settle();
    await settle();

    for (let value = 1; value <= 20; value++) bus.publish(value);
    await settle();
    await settle();

    await Fiber.interrupt(reading).pipe(Effect.runPromise);

    // Every one of the twenty, and NOT twenty chunks: a consumer that came
    // back once was handed the backlog once.
    const delivered = chunks.flat();
    expect(delivered).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(chunks.length).toBeLessThan(delivered.length);
    // ...and the twenty rode together, which is the claim: a per-value chunk
    // is one round trip per value.
    expect(chunks.some((chunk) => chunk.length >= 20)).toBe(true);
  });

  it("still delivers one at a time when they are published one at a time", async () => {
    // The other half, so the batching cannot be read as "the stream waits for
    // more": a publish with nothing behind it goes out on its own.
    const { bus, stream } = subscription();
    const chunks: number[][] = [];
    const reading = Effect.runFork(
      Stream.runForEachArray(stream, (values) =>
        Effect.sync(() => {
          chunks.push([...values]);
        }),
      ),
    );
    await settle();
    for (const value of [1, 2, 3]) {
      bus.publish(value);
      await settle();
    }
    await Fiber.interrupt(reading).pipe(Effect.runPromise);

    expect(chunks.flat()).toEqual([0, 1, 2, 3]);
    expect(chunks.every((chunk) => chunk.length === 1)).toBe(true);
  });
});
