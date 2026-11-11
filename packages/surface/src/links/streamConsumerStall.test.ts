/**
 * One STALLED stream consumer must hold up its own stream — never the link.
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
 * Measured here against the real loopback-wired stdio link:
 *
 *  A. a consumer that takes one frame and then stalls for 12 s — past
 *     `RPC_PING_FATAL_SILENCE_MS`, so the old reader would have died of it —
 *     and then RESUMES with every frame, in order: the stall cost nothing but
 *     its own stream's progress, which is backpressure surviving the decoupling;
 *  B. a consumer that takes one frame, stalls briefly, and is INTERRUPTED;
 *  C. a chunk the client cannot decode fails ITS stream and nothing else;
 *  D. a protocol without acks is refused when the link is built, because the
 *     per-request lane is only bounded by the ack.
 *
 * Real time for A and B, for the reason `stdioPingStall.test.ts` gives: the
 * pinger's cadence is hardcoded in Effect, so there is no clock to fake without
 * faking the thing under test. "Answers" is bounded by `ANSWER_WITHIN_MS` rather
 * than awaited bare, because the failure being guarded against is a call that
 * never answers.
 */

import { setTimeout as delay } from "node:timers/promises";
import { Cause, Effect, Exit, Fiber, Layer, Schema, Stream } from "effect";
import { RpcClient } from "effect/rpc";
import { describe, expect, it } from "vitest";
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
 *  generous for a loaded box, and far inside the ping window the old reader
 *  died in. */
const ANSWER_WITHIN_MS = 3_000;

/** The A stall: past the whole-link deadline the old reader died of. */
const STALL_MS = RPC_PING_FATAL_SILENCE_MS + 2_000;

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
          if (seen.length === 1) await delay(stallMs);
        }),
    ),
  );
  return { fiber, seen };
}

describe.concurrent("wire link — a stalled stream consumer", () => {
  it("A: unrelated calls answer through the stall, the link outlives it, and the stalled stream resumes in order with no gap", async () => {
    const w = await wiredLoopback();
    try {
      const consumer = stallingConsumer(w, FRAMES, STALL_MS);
      await delay(1_000);
      expect(consumer.seen).toEqual([0]);
      // The consumer's queue is full and a delivery is parked on it; a reader
      // that delivers in line would not see this answer at all.
      expect(await answers(w.link, 2, 3)).toBe(5);

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
      await delay(500);
      expect(consumer.seen).toEqual([0]);
      await Effect.runPromise(Fiber.interrupt(consumer.fiber));

      expect(await answers(w.link, 2, 3)).toBe(5);
      // Past the whole-link deadline: a reader left parked on the orphaned
      // queue would have let the pinger kill the link by now.
      await delay(RPC_PING_FATAL_SILENCE_MS + 1_000);
      expect(await answers(w.link, 40, 2)).toBe(42);
    } finally {
      await w.done();
    }
  }, 60_000);

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
