/**
 * One STALLED stream consumer must hold up its own stream — never the link.
 * The hazard and the workaround are argued once, in `./deliveryLanes.ts`; this
 * file measures them.
 *
 * Measured here against the real loopback-wired stdio link:
 *
 *  A. a consumer that takes one frame and then stalls past
 *     `RPC_PING_FATAL_SILENCE_MS` — so a reader parked on its queue would have
 *     let the pinger kill the link — and then RESUMES with every frame, in
 *     order: the stall cost nothing but its own stream's progress, which is
 *     backpressure surviving the decoupling;
 *  B. a consumer that takes one frame, stalls briefly, and is INTERRUPTED;
 *  C. a chunk the client cannot decode fails ITS stream and nothing else;
 *  D. a protocol without acks is refused when the link is built, because the
 *     per-request lane is only bounded by the ack.
 *
 * A and B run their stall on a VIRTUAL clock, for the reason
 * `stdioPingStall.test.ts` gives: only `setTimeout` and `Date` are faked, so
 * the pinger is Effect's real one and the bytes are real. The clock is walked a
 * second at a time with a real breath between steps (the one real wait here:
 * the loopback bytes, pongs included, move on the real event loop), so the
 * peer's pongs are read as they would be in production. "Answers" is bounded
 * by `ANSWER_WITHIN_MS` rather than awaited bare, because the failure being
 * guarded against is a call that never answers.
 */

import { setTimeout as breathe } from "node:timers/promises";
import { Cause, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect";
import { RpcClient } from "effect/rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineSurface } from "../define";
import { RPC_PING_FATAL_SILENCE_MS } from "../keepAlive";
import { createLoopbackPair, greetLoopback } from "../loopback";
import { serveOverStdio } from "../peer-server";
import { stdioLink } from "./stdio";
import {
  buildLoopbackRuntime,
  type LoopbackWired,
  loopbackSurface,
  wiredLoopback,
} from "./loopbackWired.testlib";
import { openWireLink } from "./wire";

/** How long an unrelated call may take to answer and still count as answered —
 *  generous for a loaded box, and far inside every keep-alive deadline. */
const ANSWER_WITHIN_MS = 3_000;

/** The A stall: past the whole-link deadline a parked reader would die of. */
const STALL_MS = RPC_PING_FATAL_SILENCE_MS + 2_000;

/** Walk the virtual clock `ms` forward, one second at a time, with a REAL
 *  breath between steps so every byte in flight (the peer's pongs included) is
 *  read before the next pinger tick — the cadence production sees. */
async function passVirtually(ms: number): Promise<void> {
  for (let walked = 0; walked < ms; walked += 1_000) {
    await vi.advanceTimersByTimeAsync(1_000);
    await breathe(2);
  }
}

/** A virtual-clock wait: resolves when the faked `setTimeout` fires. */
function virtualDelay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Far more frames than the stream's buffer holds, so the stalled consumer's
 *  queue is full and a delivery is parked on it for the whole stall. */
const FRAMES = 2_000;

const answers = (link: LoopbackWired["link"], a: number, b: number) =>
  Effect.runPromise(
    Effect.timeout(
      link.dispatch.unary("surface/math/add", { a, b }) as Effect.Effect<
        number,
        unknown
      >,
      ANSWER_WITHIN_MS,
    ),
  );

/** Run the counter on its own fiber, recording every `n`: the first frame
 *  awaits `stallMs`, every later one is taken at once. */
function stallingConsumer(w: LoopbackWired, to: number, stallMs: number) {
  const seen: number[] = [];
  const fiber = Effect.runFork(
    Stream.runForEach(
      w.link.dispatch.stream("surface/counter/get", { to }) as Stream.Stream<
        { n: number },
        unknown
      >,
      ({ n }) =>
        Effect.promise(async () => {
          seen.push(n);
          if (seen.length === 1) await virtualDelay(stallMs);
        }),
    ),
  );
  return { fiber, seen };
}

describe("wire link — a stalled stream consumer (virtual clock)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("A: unrelated calls answer through the stall, the link outlives it, and the stalled stream resumes in order with no gap", async () => {
    const w = await wiredLoopback();
    try {
      const consumer = stallingConsumer(w, FRAMES, STALL_MS);
      await breathe(1_000);
      expect(consumer.seen).toEqual([0]);
      // The consumer's queue is full and a delivery is parked on it; a reader
      // that delivers in line would not see this answer at all.
      expect(await answers(w.link, 2, 3)).toBe(5);

      await passVirtually(STALL_MS);
      await Effect.runPromise(Fiber.join(consumer.fiber));
      // Past the stall: the link is alive — the pinger was answered throughout.
      expect(await answers(w.link, 20, 3)).toBe(23);
      // And nothing was dropped or reordered: the sender waited on the
      // withheld ack instead of the reader waiting on the consumer.
      expect(consumer.seen).toEqual(
        Array.from({ length: FRAMES }, (_, i) => i),
      );
    } finally {
      await w.done();
    }
  }, 60_000);

  it("B: a consumer interrupted while full leaves the link answering, past the ping window", async () => {
    const w = await wiredLoopback();
    try {
      const consumer = stallingConsumer(w, 1_000_000, STALL_MS);
      await breathe(500);
      expect(consumer.seen).toEqual([0]);
      await Effect.runPromise(Fiber.interrupt(consumer.fiber));

      expect(await answers(w.link, 2, 3)).toBe(5);
      // Past the whole-link deadline: a reader left parked on the orphaned
      // queue would have let the pinger kill the link by now.
      await passVirtually(RPC_PING_FATAL_SILENCE_MS + 1_000);
      expect(await answers(w.link, 40, 2)).toBe(42);
    } finally {
      await w.done();
    }
  }, 60_000);
});

describe.concurrent("wire link — a stalled stream consumer", () => {
  it("C: a chunk the client cannot decode fails its own stream and leaves the link answering", async () => {
    // The CLIENT is built from a surface whose counter frames are strings, so
    // every frame the real server sends fails to decode. Effect writes that
    // failure as the request's exit before re-raising it; the lane must hand it
    // to the consumer and let go, not wedge or take the link with it.
    const skewed = defineSurface({
      procedures: {
        math: {
          add: {
            input: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
            output: Schema.Number,
          },
        },
      },
      streams: {
        counter: {
          inputSchema: Schema.Struct({ to: Schema.Number }),
          outputSchema: Schema.Struct({ n: Schema.String }),
        },
      },
    });
    const runtime = buildLoopbackRuntime();
    const pair = createLoopbackPair();
    const serving = serveOverStdio({
      group: runtime.group,
      handlers: runtime.handlers,
      transport: pair.server,
    });
    const link = await stdioLink({
      group: skewed.group,
      read: pair.client.read,
      write: pair.client.write,
      readiness: await greetLoopback(pair),
    });
    try {
      const exit = await Effect.runPromiseExit(
        Stream.runDrain(
          link.dispatch.stream("surface/counter/get", { to: 3 }),
        ).pipe(Effect.timeout(ANSWER_WITHIN_MS)),
      );
      // The decode failure is a defect on THIS stream — not the timeout a
      // wedged lane would produce, and not a transport death.
      expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
      expect(await answers(link, 1, 2)).toBe(3);
    } finally {
      await link.dispose();
      pair.client.write.end();
      pair.server.write.end();
      await serving;
      await runtime.close();
    }
  });

  it("D: a protocol without acks is refused when the link is built", async () => {
    const noAcks = Layer.succeed(RpcClient.Protocol)({
      run: () => Effect.never,
      send: () => Effect.void,
      supportsAck: false,
      supportsTransferables: false,
      codecFor: ((schema: unknown) => schema) as never,
    });
    await expect(
      openWireLink({
        group: loopbackSurface.group,
        protocol: noAcks,
        transportError: (error) => error,
        disposedError: () => new Error("disposed"),
      }),
    ).rejects.toThrow(/does not support acks/);
  });
});
