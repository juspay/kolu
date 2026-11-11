/**
 * One STALLED stream consumer must cost one stream — never the link.
 *
 * Every stream on a wire link shares one socket reader, and Effect RPC's reader
 * delivers a stream chunk by offering into that stream's bounded queue. Before
 * `openWireLink` took delivery off the reader (`decoupleDelivery`, `wire.ts`), a
 * consumer that stopped pulling parked the READER on its full queue: no unary
 * answer, no other stream and no keep-alive `Pong` was read, and Effect's pinger
 * killed a link whose peer was healthy throughout. A consumer torn down while
 * full left the reader parked on the orphaned queue for good. Production paid
 * for it as a remote host "disconnecting" every few minutes, each drop
 * re-attaching every terminal.
 *
 * Both shapes are measured here against the real loopback-wired stdio link:
 *
 *  A. a consumer that takes one frame and then stalls for 12 s — past
 *     `RPC_PING_FATAL_SILENCE_MS`, so the old reader would have died of it;
 *  B. a consumer that takes one frame, stalls briefly, and is INTERRUPTED.
 *
 * Real time, for the reason `stdioPingStall.test.ts` gives: the pinger's cadence
 * is hardcoded in Effect, so there is no clock to fake without faking the thing
 * under test. "Answers" is bounded by `ANSWER_WITHIN_MS` rather than awaited
 * bare, because the failure being guarded against is a call that never answers.
 */

import { setTimeout as delay } from "node:timers/promises";
import { Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { SurfaceStreamStalled } from "../errors";
import { RPC_PING_FATAL_SILENCE_MS } from "../keepAlive";
import { wiredLoopback } from "./loopbackWired.testlib";

/** How long an unrelated call may take to answer and still count as answered —
 *  generous for a loaded box, and far inside the ping window the old reader
 *  died in. */
const ANSWER_WITHIN_MS = 3_000;

/** The A stall: past the whole-link deadline the old reader died of. */
const STALL_MS = RPC_PING_FATAL_SILENCE_MS + 2_000;

async function wiredWithCounter() {
  const w = await wiredLoopback();
  const add = (a: number, b: number) =>
    Effect.runPromise(
      Effect.timeout(
        w.link.dispatch.unary("surface/math/add", { a, b }) as Effect.Effect<
          number,
          unknown
        >,
        ANSWER_WITHIN_MS,
      ),
    );
  /** Subscribe to a counter that never runs dry and run it on its own fiber:
   *  the first frame awaits `stallMs`, every later one is taken at once. */
  const stallingConsumer = (stallMs: number) => {
    let seen = 0;
    const fiber = Effect.runFork(
      Stream.runForEach(
        w.link.dispatch.stream("surface/counter/get", { to: 1_000_000 }),
        () =>
          Effect.promise(async () => {
            seen += 1;
            if (seen === 1) await delay(stallMs);
          }),
      ),
    );
    return { fiber, seen: () => seen };
  };
  return { ...w, add, stallingConsumer };
}

describe.concurrent("wire link — a stalled stream consumer", () => {
  it("A: unrelated calls answer through the stall, the link outlives it, and the stalled stream ends with SurfaceStreamStalled", async () => {
    const w = await wiredWithCounter();
    try {
      const consumer = w.stallingConsumer(STALL_MS);
      await delay(1_000);
      expect(consumer.seen()).toBe(1);
      // The consumer's queue is full and a delivery is waiting on it; a reader
      // that delivers in line would not see this answer at all.
      expect(await w.add(2, 3)).toBe(5);

      const error = await Effect.runPromise(
        Effect.flip(Fiber.join(consumer.fiber)),
      );
      // Past the stall: the link is alive — the pinger was answered throughout.
      expect(await w.add(20, 3)).toBe(23);
      // And the stalled stream was dropped by NAME, not by a transport death.
      expect(error).toBeInstanceOf(SurfaceStreamStalled);
    } finally {
      await w.done();
    }
  }, 60_000);

  it("B: a consumer interrupted while full leaves the link answering, past the ping window", async () => {
    const w = await wiredWithCounter();
    try {
      const consumer = w.stallingConsumer(STALL_MS);
      await delay(500);
      expect(consumer.seen()).toBe(1);
      await Effect.runPromise(Fiber.interrupt(consumer.fiber));

      expect(await w.add(2, 3)).toBe(5);
      // Past the whole-link deadline: a reader left parked on the orphaned
      // queue would have let the pinger kill the link by now.
      await delay(RPC_PING_FATAL_SILENCE_MS + 1_000);
      expect(await w.add(40, 2)).toBe(42);
    } finally {
      await w.done();
    }
  }, 60_000);
});
