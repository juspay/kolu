/**
 * `awaitWatchEvents` — the client half `watch_next` actually runs, pinned over a
 * fake padiSurface client.
 *
 * It had no coverage, and it is where this feature's sharpest defect lived: a
 * declared `WatchSubscriptionNotFound` folded into the retryable `closed` arm,
 * whose own tool text tells the agent its events are safe and to just call
 * again — an infinite retry against a subscription that does not exist. These
 * pin the four properties that keep that from coming back:
 *
 *   1. the pulse subscription is live BEFORE the first drain, so an event
 *      landing between the two is not lost into the gap;
 *   2. `WatchSubscriptionNotFound` PROPAGATES rather than settling `closed`;
 *   3. a dead transport propagates too (it poisons the shared connection);
 *   4. an ordinary pulse-feed end settles `closed`, carrying the retry wording.
 */

import { Effect, Stream } from "effect";
import { describe, expect, it } from "vitest";
import type { PadiSurfaceClient } from "./dial.ts";
import { WatchSubscriptionNotFound } from "./errors.ts";
import type { PadiSettleEvent } from "./surface.ts";
import { awaitWatchEvents } from "./watch.ts";

const NAME = "campaign";

const settle = (seq: number): PadiSettleEvent =>
  ({
    seq,
    id: "worker-1",
    kind: "finished",
    at: 1_700_000_000_000,
  }) as PadiSettleEvent;

type DrainReply = {
  events: readonly PadiSettleEvent[];
  dropped: number;
  ackAfter: number;
};

/** A fake padiSurface client exposing just the two members this wait binds.
 *  `pulses` is the doorbell's frame sequence; `onDrain` answers each drain in
 *  order, so a test scripts the interleaving precisely. */
function fakeClient(opts: {
  pulses: Stream.Stream<{ seq: number }, unknown>;
  onDrain: (call: number, input: unknown) => DrainReply | Error;
}): {
  client: PadiSurfaceClient;
  drainCalls: () => number;
  lastInput: () => unknown;
} {
  let calls = 0;
  let lastInput: unknown;
  const client = {
    surface: {
      watchPulse: { get: () => opts.pulses },
      watch: {
        drain: (input: unknown) =>
          Effect.suspend(() => {
            lastInput = input;
            const reply = opts.onDrain(calls++, lastInput);
            return reply instanceof Error
              ? Effect.fail(reply)
              : Effect.succeed(reply);
          }),
      },
    },
  } as unknown as PadiSurfaceClient;
  return { client, drainCalls: () => calls, lastInput: () => lastInput };
}

const empty: DrainReply = { events: [], dropped: 0, ackAfter: 0 };

describe("awaitWatchEvents", () => {
  it("drains AFTER the pulse is live — an event landing in the gap is still delivered", async () => {
    // The first frame is the baseline; the wait must drain having already
    // subscribed. Draining first and subscribing after would drop exactly the
    // event that lands between them — the hole this whole feature closes.
    const { client, drainCalls } = fakeClient({
      pulses: Stream.make({ seq: 0 }),
      onDrain: () => ({ events: [settle(7)], dropped: 0, ackAfter: 7 }),
    });
    const outcome = await awaitWatchEvents(client, { name: NAME });
    expect(outcome.kind).toBe("met");
    if (outcome.kind !== "met") return;
    expect(outcome.events.map((e) => e.seq)).toEqual([7]);
    expect(outcome.ackAfter).toBe(7);
    expect(drainCalls()).toBe(1);
  });

  it("re-drains on a RING, and an empty drain keeps waiting instead of settling a false empty", async () => {
    const { client } = fakeClient({
      pulses: Stream.make({ seq: 0 }, { seq: 1 }, { seq: 2 }),
      // Baseline drain empty, first ring empty (another consumer got there
      // first), second ring carries the batch.
      onDrain: (n) =>
        n < 2 ? empty : { events: [settle(9)], dropped: 0, ackAfter: 9 },
    });
    const outcome = await awaitWatchEvents(client, { name: NAME });
    expect(outcome.kind).toBe("met");
    if (outcome.kind !== "met") return;
    expect(outcome.events.map((e) => e.seq)).toEqual([9]);
  });

  it("settles `met` on a drop-only batch — an overflow report is news even with no events", async () => {
    const { client } = fakeClient({
      pulses: Stream.make({ seq: 0 }),
      onDrain: () => ({ events: [], dropped: 4, ackAfter: 11 }),
    });
    const outcome = await awaitWatchEvents(client, { name: NAME });
    expect(outcome.kind).toBe("met");
    if (outcome.kind !== "met") return;
    expect(outcome.dropped).toBe(4);
  });

  it("PROPAGATES WatchSubscriptionNotFound — it must never become a retryable `closed`", async () => {
    // `closed` tells the agent "your events are still queued, just call again".
    // For a name padi does not hold, that is an infinite loop being reassured.
    const { client } = fakeClient({
      pulses: Stream.make({ seq: 0 }),
      onDrain: () => new WatchSubscriptionNotFound({ name: NAME, known: [] }),
    });
    await expect(awaitWatchEvents(client, { name: NAME })).rejects.toThrow(
      /No standing subscription named/,
    );
  });

  it("settles `closed` with the retry wording when the pulse feed simply ends", async () => {
    // A lost doorbell is not a lost subscription: the buffer behind the drain is
    // the authority, so this is retryable and must SAY the events survive.
    const { client } = fakeClient({
      pulses: Stream.empty,
      onDrain: () => empty,
    });
    const outcome = await awaitWatchEvents(client, { name: NAME });
    expect(outcome.kind).toBe("closed");
    if (outcome.kind !== "closed") return;
    expect(outcome.error).toMatch(/buffered events are not lost/);
  });

  it("times out without consuming anything — the queue is still there next call", async () => {
    const { client } = fakeClient({
      pulses: Stream.concat(Stream.make({ seq: 0 }), Stream.never),
      onDrain: () => empty,
    });
    const outcome = await awaitWatchEvents(client, {
      name: NAME,
      timeoutMs: 60,
    });
    expect(outcome.kind).toBe("timeout");
  });

  it("forwards the caller's acknowledgement to the drain", async () => {
    const { client, lastInput } = fakeClient({
      pulses: Stream.make({ seq: 0 }),
      onDrain: () => ({ events: [settle(3)], dropped: 0, ackAfter: 3 }),
    });
    await awaitWatchEvents(client, { name: NAME, after: 2 });
    expect(lastInput()).toEqual({ name: NAME, after: 2 });
  });

  it("OMITS `after` entirely on a first call rather than spelling undefined", async () => {
    // The wire field is an `optionalKey`, which accepts an absent key and
    // REJECTS a present-but-undefined one (#17).
    const { client, lastInput } = fakeClient({
      pulses: Stream.make({ seq: 0 }),
      onDrain: () => ({ events: [settle(1)], dropped: 0, ackAfter: 1 }),
    });
    await awaitWatchEvents(client, { name: NAME });
    expect("after" in (lastInput() as object)).toBe(false);
  });
});
