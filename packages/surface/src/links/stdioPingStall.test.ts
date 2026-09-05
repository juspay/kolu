/**
 * A peer that goes SILENT but is not dead — the shape that took a production
 * host down, and the INCIDENT NARRATIVE for it. A box at load 67 on 16 cores,
 * its `padi --stdio` front too starved to answer inside Effect RPC's ping
 * window: the agent was alive throughout and demonstrably served a request 79ms
 * after we had declared it dead. juspay/kolu#2101 had already burned an incident
 * on the same reading — a log line "indistinguishable from an unreachable box".
 *
 * Why the death can be read as the keep-alive at all, why the deadline is not a
 * knob, and why the link cannot be retried through are argued ONCE, in
 * `keepAliveWentUnanswered` and `neverReconnect` in `links/wire.ts`. This file
 * measures them rather than restating them.
 *
 * What it measures:
 *
 *  1. the bytes never stop flowing permanently — the pipes are open at both ends
 *     throughout, and the server answers correctly the instant a SHORT stall
 *     lifts. Nothing here is ever a dead fd;
 *  2. a stall past the ping window nevertheless kills the link, irrecoverably;
 *  3. and the diagnosis it dies with names the keep-alive — as DATA, on
 *     `death` — rather than claiming the peer exited, which is the part this
 *     repo can actually fix.
 *
 * Real time, deliberately: the pinger's cadence is hardcoded in Effect, so there
 * is no clock to fake without faking the thing under test. But the file never
 * SLEEPS past the deadline: it parks a call on the corked wire and awaits that
 * call's own rejection, which settles at the real death. A sleep would be a
 * guess at Effect's cadence — a second, independent derivation of it beside
 * `socketRedialLaws.test.ts`'s, and a flake surface on a loaded box.
 */

import { setTimeout as delay } from "node:timers/promises";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { SurfaceStdioTransportClosed } from "../errors";
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

    // Hold the wire for a beat — well inside `RPC_PING_INTERVAL_MS` (`wire.ts`),
    // so this is only ever a pause. The assertion after `resume()` is what
    // carries the meaning; the duration only has to be short enough to be
    // unambiguous.
    w.stall();
    await delay(200);
    w.resume();

    expect(await w.add(20, 3)).toBe(23);
    await w.done();
  }, 30_000);

  it("a stall PAST the ping window kills the link — and says the keep-alive went unanswered, not that the peer exited", async () => {
    const w = await wiredThroughStalls();
    expect(await w.add(2, 3)).toBe(5);

    // Cork the wire and park a call on it, then await THAT call's rejection.
    // Effect RPC registers a request's entry before it forks the send fiber, so
    // this call is a registered entry sitting on a write that cannot flush; when
    // the pinger gives up it broadcasts a protocol error that fails EVERY
    // registered entry. So this settles at the real death — no sleep, no margin
    // tuned for a loaded CI box, and no second local derivation of Effect's
    // cadence.
    w.stall();
    const failure = await w.failure(40, 2);

    // The link IS dead — that is Effect's pinger, not ours to move — and it is
    // dead with the leg's own typed error, read as its own type rather than
    // through a structural cast.
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    const closed = failure as SurfaceStdioTransportClosed;

    // The DISCRIMINANT, not the sentence. This is the assertion that fails if
    // the classification regresses, and it is what a consumer branches on — so
    // the wording below stays re-writable instead of becoming load-bearing API.
    // Reading it off the narrowed class is the point of shipping it as a closed
    // `Schema.Literals`: `"streamEnded"` here would not compile-and-pass, it
    // would compile and FAIL.
    expect(closed.death).toBe("keepAliveUnanswered");

    // One prose check, and it is about the LABEL rather than the diagnosis: the
    // transport `describe` must reach the operator's line. The never-claims that
    // used to sit here — "no `timeout waiting for \"open\"`", "no `the peer
    // process exited`" — are derivable from `death` and hardcoded the OTHER
    // arms' wording, so they broke on a legitimate rewrite of a sentence they
    // were not guarding.
    expect(closed.message).toContain("padi on a starved host");

    // The stall lifts and every held byte flushes in order, with nothing
    // destroyed by the test at either end — and the link stays dead anyway.
    // That is `neverReconnect`: the corpse is not resurrected by the peer coming
    // back, which is exactly why the DIAGNOSIS is the part worth getting right.
    w.resume();
    expect(await w.failure(1, 1)).toBeInstanceOf(SurfaceStdioTransportClosed);

    await w.done();
  }, 60_000);
});
