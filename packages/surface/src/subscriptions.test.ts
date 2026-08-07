/**
 * The per-subscription liveness registry, and the fence that feeds it.
 *
 * The fact under test is the one the field incident needed and nothing could
 * state: *this subscription last heard from the server at T*. A parked stream
 * is neither pending nor erroring, so `client.health()` reads it as perfectly
 * healthy — only a frame TIMESTAMP can tell it from a live one.
 */

import { Effect, Exit, Stream } from "effect";
import {
  RpcClientDefect,
  RpcClientError,
} from "effect/unstable/rpc/RpcClientError";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fenceStream, STREAM_RETRY_DELAY_MS } from "./client";
import {
  ENDED_RETENTION,
  registerSubscription,
  resetSubscriptionLiveness,
  subscriptionLiveness,
  UNLABELED_SUBSCRIPTION,
} from "./subscriptions";

/** A transport failure the fence RETRIES — matched structurally on the `_tag`,
 *  exactly as `shouldRetryStreamError` does. */
const transportFailure = () =>
  new RpcClientError({
    reason: new RpcClientDefect({
      message: "socket died",
      cause: new Error("socket died"),
    }),
  });

beforeEach(() => {
  resetSubscriptionLiveness();
});

describe("the registry", () => {
  it("names an unlabelled subscription rather than hiding it", () => {
    registerSubscription(undefined);
    expect(subscriptionLiveness().map((r) => r.label)).toEqual([
      UNLABELED_SUBSCRIPTION,
    ]);
  });

  it("keeps every LIVE record and only the last N ended ones", () => {
    for (let i = 0; i < ENDED_RETENTION + 5; i++) {
      registerSubscription(`ended-${i}`).finish(Exit.void);
    }
    registerSubscription("live-one");
    const labels = subscriptionLiveness().map((r) => r.label);
    expect(labels).toHaveLength(ENDED_RETENTION + 1);
    // The OLDEST ended records were evicted; the live one is untouchable.
    expect(labels).not.toContain("ended-0");
    expect(labels).toContain(`ended-${ENDED_RETENTION + 4}`);
    expect(labels).toContain("live-one");
  });
});

describe("fenceStream feeds the registry", () => {
  it("registers when the subscription RUNS, not when its value is built", async () => {
    const fenced = fenceStream(Stream.make(1, 2), { label: "ticks" });
    // A fenced stream is a lazy description a consumer may hold and never run.
    // A record minted here would be a subscription the snapshot claims exists.
    expect(subscriptionLiveness()).toEqual([]);

    await Effect.runPromise(Stream.runDrain(fenced));
    const [record] = subscriptionLiveness();
    expect(record?.label).toBe("ticks");
    expect(record?.framesReceived).toBe(2);
    expect(record?.state).toBe("ended");
  });

  it("stamps lastFrameAt at DELIVERY, so a stream that never yields has none", async () => {
    const before = Date.now();
    const fiber = Effect.runFork(
      Stream.runDrain(fenceStream(Stream.never, { label: "silent" })),
    );
    await vi.waitFor(() => expect(subscriptionLiveness()).toHaveLength(1));
    const parked = subscriptionLiveness()[0];
    // THE PARK'S SIGNATURE at the registry level: subscribed, alive, no frame.
    expect(parked?.state).toBe("live");
    expect(parked?.framesReceived).toBe(0);
    expect(parked?.lastFrameAt).toBeUndefined();
    expect(parked?.subscribedAt).toBeGreaterThanOrEqual(before);

    fiber.interruptUnsafe();
    await vi.waitFor(() =>
      expect(subscriptionLiveness()[0]?.state).toBe("ended"),
    );
    // An interrupt IS the unsubscribe — an ordinary end, never a fault.
    expect(subscriptionLiveness()[0]?.lastError).toBeUndefined();
  });

  it("counts a retryable failure as a RETRY on the SAME record, and the frames that follow it", async () => {
    let attempt = 0;
    const flaky = Stream.suspend(() => {
      attempt += 1;
      return attempt === 1
        ? Stream.fail(transportFailure())
        : Stream.make("fresh");
    });
    await Effect.runPromise(
      Stream.runDrain(fenceStream(flaky, { label: "flaky" })).pipe(
        Effect.timeout(STREAM_RETRY_DELAY_MS * 4),
      ),
    );
    // ONE record, not two: a re-subscribe is the same subscription, and a
    // registry that minted a record per attempt would report a tab full of
    // phantom streams after any wifi blip.
    expect(subscriptionLiveness()).toHaveLength(1);
    const record = subscriptionLiveness()[0];
    expect(record?.retries).toBe(1);
    expect(record?.framesReceived).toBe(1);
    expect(record?.lastError).toContain("socket died");
    expect(record?.state).toBe("ended");
  });

  it("records a failure the fence REFUSES to retry as failed, with its message", async () => {
    await Effect.runPromise(
      Stream.runDrain(
        fenceStream(Stream.fail(new Error("declared: nope")), {
          label: "declared",
        }),
      ).pipe(Effect.ignore),
    );
    const record = subscriptionLiveness()[0];
    expect(record?.state).toBe("failed");
    expect(record?.retries).toBe(0);
    expect(record?.lastError).toContain("declared: nope");
  });
});
