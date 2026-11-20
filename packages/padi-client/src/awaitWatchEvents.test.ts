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
    const { client } = fakeClient({
      pulses: Stream.make({ seq: 0 }),
      onDrain: () => new WatchSubscriptionNotFound({ name: NAME, known: [] }),
    });
    await expect(awaitWatchEvents(client, { name: NAME })).rejects.toThrow(
      /No standing subscription named/,
    );
  });

  it("settles `closed` with the retry wording when the pulse feed simply ends", async () => {
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
    const { client, lastInput } = fakeClient({
      pulses: Stream.make({ seq: 0 }),
      onDrain: () => ({ events: [settle(1)], dropped: 0, ackAfter: 1 }),
    });
    await awaitWatchEvents(client, { name: NAME });
    expect("after" in (lastInput() as object)).toBe(false);
  });
});
