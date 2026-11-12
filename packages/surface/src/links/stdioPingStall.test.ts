/**
 * A peer that goes SILENT but is not dead — the shape that took a production
 * host down, and the INCIDENT NARRATIVE for it. A box at load 67 on 16 cores,
 * its `padi --stdio` front too starved to answer inside Effect RPC's old 5–10s
 * ping window: the agent was alive throughout and demonstrably served a request
 * 79ms after we had declared it dead. juspay/kolu#2101 had already burned an
 * incident on the same reading — a log line "indistinguishable from an
 * unreachable box". The link now owns its keep-alive and sets the pinger as a
 * BACKSTOP above the framework watchdog.
 *
 * Why the death can be read as the keep-alive at all, what sets its deadline,
 * and why the link cannot be retried through are argued ONCE, in
 * `keepAlive.ts` (and `neverReconnect` in `links/wire.ts`). This file measures
 * them rather than restating them:
 *
 *  1. the bytes never stop flowing permanently — the pipes are open at both ends
 *     throughout, and the server answers correctly the instant a stall lifts,
 *     including one longer than the old ping window AND the watchdog's verdict;
 *  2. an ordinary read failure is `streamEnded`, not the keep-alive;
 *  3. total silence past the backstop kills the link, irrecoverably, and the
 *     death lands where `RPC_PING_FATAL_SILENCE_MS` says — measured, not
 *     assumed;
 *  4. and the diagnosis it dies with names the keep-alive — as DATA, on
 *     `death`, set by `onPingTimeout` — rather than claiming the peer exited.
 *
 * The long waits run on a VIRTUAL clock (see the second `describe`): a minute
 * of real silence per run would be a flake surface, and faking only `setTimeout`
 * and `Date` leaves the pinger itself — Effect's `makePinger`, fed by a real
 * wire — exactly the code production runs.
 */

import { setTimeout as delay } from "node:timers/promises";
import { Effect, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SurfaceStdioTransportClosed } from "../errors";
import {
  RPC_PING_FATAL_SILENCE_MS,
  RPC_PING_INTERVAL_MS,
  RPC_PING_TIMEOUT_MS,
} from "../keepAlive";
import { stallLoopback } from "../loopback";
import { wiredLoopback } from "./loopbackWired.testlib";

/** The package's shared loopback harness, plus the two things only this file
 *  needs: `stall`/`resume` (cork BOTH directions — nothing is destroyed and no
 *  FIN is sent, so the only fact injected is "the peer said nothing"), and a
 *  raw `call` Effect, so a failure can be awaited and read TYPED rather than
 *  caught and structurally poked at. */
async function wiredThroughStalls() {
  const w = await wiredLoopback({ describe: "padi on a starved host" });
  const call = (a: number, b: number) =>
    w.link.dispatch.unary("surface/math/add", { a, b }) as Effect.Effect<
      number,
      unknown
    >;
  return {
    call,
    add: (a: number, b: number) => Effect.runPromise(call(a, b)),
    /** Await this call's FAILURE, typed. */
    failure: (a: number, b: number) =>
      Effect.runPromise(Effect.flip(call(a, b))),
    ...stallLoopback(w.pair),
    done: w.done,
  };
}

describe.concurrent("stdio link — a peer that is slow, not dead", () => {
  it("answers again the moment the stall lifts: the pipes were never broken", async () => {
    const w = await wiredThroughStalls();
    expect(await w.add(2, 3)).toBe(5);

    // Hold the wire for a beat — well inside `RPC_PING_INTERVAL_MS` (`keepAlive.ts`),
    // so this is only ever a pause. The assertion after `resume()` is what
    // carries the meaning; the duration only has to be short enough to be
    // unambiguous.
    w.stall();
    await delay(200);
    w.resume();

    expect(await w.add(20, 3)).toBe(23);
    await w.done();
  }, 30_000);

  it("an ordinary read failure is streamEnded, not an unanswered heartbeat", async () => {
    const w = await wiredLoopback();
    try {
      expect(
        await Effect.runPromise(
          w.link.dispatch.unary("surface/math/add", { a: 1, b: 2 }),
        ),
      ).toBe(3);
      const failure = Effect.runPromise(
        Effect.flip(
          Stream.runDrain(
            w.link.dispatch.stream("surface/counter/get", { to: 0 }),
          ),
        ),
      );
      w.pair.client.read.destroy(new Error("read failure"));
      const error = await failure;
      expect(error).toBeInstanceOf(SurfaceStdioTransportClosed);
      expect((error as SurfaceStdioTransportClosed).death).toBe("streamEnded");
    } finally {
      await w.done();
    }
  });
});

/** The silence a default framework watchdog needs to reach its verdict
 *  (`heartbeat.ts`: 15s interval + 10s timeout). Spelled here, not imported,
 *  because it is only the yardstick for "past the point where the watchdog
 *  would already have decided"; `keepaliveOrdering.test.ts` pins the real one. */
const WATCHDOG_VERDICT_MS = 25_000;

/** The pinger on a VIRTUAL clock. Only time is faked — `setTimeout` (Effect's
 *  sleep, and so the pinger's tick) and `Date` (Effect's `Clock`, which the
 *  pinger reads for `lastSeen`). `setImmediate` stays real, so Effect's own
 *  scheduler and every stream byte run exactly as in production: the pinger
 *  under test is Effect's real `makePinger` with the numbers `duplexWireLink`
 *  really passes, fed by a real loopback wire. Nothing in a public factory
 *  takes a timing argument to make this possible. */
describe("stdio link — the keep-alive is a backstop, not a verdict (virtual clock)", () => {
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

  it("survives total silence past the OLD 10s window and past the watchdog's 25s — and answers when it lifts", async () => {
    const w = await wiredThroughStalls();
    try {
      expect(await w.add(2, 3)).toBe(5);
      w.stall();
      // Longer than Effect's old default death (5–10s) AND than the framework
      // watchdog's verdict: a busy-but-running peer is now the watchdog's call.
      await vi.advanceTimersByTimeAsync(WATCHDOG_VERDICT_MS + 5_000);
      w.resume();
      expect(await w.add(20, 3)).toBe(23);
    } finally {
      await w.done();
    }
  });

  it("dies at the backstop — 60–65s after the last frame — as keepAliveUnanswered, named by onPingTimeout", async () => {
    const w = await wiredThroughStalls();
    try {
      expect(await w.add(2, 3)).toBe(5);

      // Cork the wire with the last frame just received (the virtual clock has
      // not moved since), and park a call on it. Effect RPC registers a
      // request's entry before it forks the send, so this is a registered entry
      // the pinger's death will fail.
      w.stall();
      const silentFrom = Date.now();
      let failedAt: number | undefined;
      const failure = w.failure(40, 2).finally(() => {
        failedAt = Date.now();
      });

      // Walk the virtual clock in 100ms steps until the call settles: the
      // MEASUREMENT of the worst-case fatal silence, read off the real pinger.
      for (
        let walked = 0;
        failedAt === undefined && walked <= 2 * RPC_PING_FATAL_SILENCE_MS;
        walked += 100
      ) {
        await vi.advanceTimersByTimeAsync(100);
      }
      const closed = await failure;
      if (failedAt === undefined) throw new Error("the call never settled");
      const silence = failedAt - silentFrom;

      // Strictly past the timeout, and no later than one tick after it.
      expect(silence).toBeGreaterThan(RPC_PING_TIMEOUT_MS);
      expect(silence).toBeLessThanOrEqual(RPC_PING_FATAL_SILENCE_MS);
      expect(RPC_PING_FATAL_SILENCE_MS).toBe(
        RPC_PING_TIMEOUT_MS + RPC_PING_INTERVAL_MS,
      );

      // The DISCRIMINANT, not the sentence — what a consumer branches on, read
      // off the narrowed class. `"streamEnded"` here would compile and FAIL.
      expect(closed).toBeInstanceOf(SurfaceStdioTransportClosed);
      expect((closed as SurfaceStdioTransportClosed).death).toBe(
        "keepAliveUnanswered",
      );
      // One prose check, about the LABEL: the transport `describe` reaches the
      // operator's line.
      expect((closed as SurfaceStdioTransportClosed).message).toContain(
        "padi on a starved host",
      );

      // The stall lifts and every held byte flushes in order — and the link
      // stays dead anyway. That is `neverReconnect`: the corpse is not
      // resurrected by the peer coming back.
      w.resume();
      expect(await w.failure(1, 1)).toBeInstanceOf(SurfaceStdioTransportClosed);
    } finally {
      await w.done();
    }
  });
});
