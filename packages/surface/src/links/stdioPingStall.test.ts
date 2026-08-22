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
 * is no clock to fake without faking the thing under test.
 */

import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import { serveOverStdio } from "../peer-server";
import { implementSurface } from "../server";
import { awaitStdioReadiness, writeStdioReadiness } from "./readiness";
import { stdioLink } from "./stdio";

/** Effect's `makePinger` sends every 5s and dies on the first tick that finds
 *  the previous ping unanswered, so total silence is fatal between 5s and 10s.
 *  Stall past the upper bound, plus margin for a loaded CI box. */
const PING_DEATH_WINDOW_MS = 13_000;

const surface = defineSurface({
  procedures: {
    math: {
      add: {
        input: Schema.Struct({ a: Schema.Number, b: Schema.Number }),
        output: Schema.Number,
      },
    },
  },
});

async function wiredThroughStalls() {
  const runtime = implementSurface(surface, {
    procedures: {
      math: { add: ({ input }) => Effect.succeed(input.a + input.b) },
    },
  });

  // Four ends and two relays, so each DIRECTION can be held independently — a
  // starved peer neither reads nor writes, so the test holds both.
  const clientWrite = new PassThrough();
  const serverRead = new PassThrough();
  const serverWrite = new PassThrough();
  const clientRead = new PassThrough();
  const upstream = new PassThrough();
  const downstream = new PassThrough();
  clientWrite.pipe(upstream).pipe(serverRead);
  serverWrite.pipe(downstream).pipe(clientRead);

  const serving = serveOverStdio({
    group: runtime.group,
    handlers: runtime.handlers,
    transport: { read: serverRead, write: serverWrite },
  });

  // The real banner, on the real wire — the gate `stdioLink` demands.
  const proof = awaitStdioReadiness({
    read: clientRead,
    deadlineMs: 10_000,
    describe: "padi on a starved host",
  });
  writeStdioReadiness(serverWrite, { verdict: "ready" });

  const link = await stdioLink({
    group: surface.group,
    read: clientRead,
    write: clientWrite,
    readiness: await proof,
  });

  const add = (a: number, b: number) =>
    Effect.runPromise(link.dispatch.unary("surface/math/add", { a, b }));

  return {
    add,
    // `cork` is node:stream's own "hold what is written to me until I say so":
    // the relay buffers instead of forwarding, and `uncork` flushes in order.
    // Nothing is destroyed, no FIN is sent, no error is raised — the only fact
    // injected is "the peer said nothing for a while", which is what a starved
    // peer that has stopped draining its socket looks like from this end.
    stall: () => {
      upstream.cork();
      downstream.cork();
    },
    resume: () => {
      upstream.uncork();
      downstream.uncork();
    },
    done: async () => {
      await link.dispose();
      clientWrite.end();
      serverWrite.end();
      await serving.catch(() => {});
      await runtime.close();
    },
  };
}

describe("stdio link — a peer that is slow, not dead", () => {
  it("answers again the moment the stall lifts: the pipes were never broken", async () => {
    const w = await wiredThroughStalls();
    expect(await w.add(2, 3)).toBe(5);

    // Hold the wire for a beat — well inside the ping window, so this is only
    // ever a pause, and prove the peer is still there afterwards.
    w.stall();
    await delay(1_000);
    w.resume();

    expect(await w.add(20, 3)).toBe(23);
    await w.done();
  }, 30_000);

  it("a stall PAST the ping window kills the link — and says the keep-alive went unanswered, not that the peer exited", async () => {
    const w = await wiredThroughStalls();
    expect(await w.add(2, 3)).toBe(5);

    w.stall();
    await delay(PING_DEATH_WINDOW_MS);
    // The peer comes back. Every byte held above is still queued and in order;
    // nothing was destroyed at either end, and the server is answering.
    w.resume();
    await delay(1_000);

    const failure = await w.add(40, 2).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    // The link IS dead — that is Effect's pinger, not ours to move.
    if (failure.ok)
      throw new Error(
        `expected the ping deadline to have killed the link, but the call answered with ${String(failure.value)}`,
      );
    const error = failure.error as {
      _tag?: string;
      death?: string;
      message?: string;
    };
    expect(error._tag).toBe("SurfaceStdioTransportClosed");

    // The DISCRIMINANT, not the sentence. This is the assertion that fails if
    // the classification regresses, and it is what a consumer branches on — so
    // the wording below stays re-writable instead of becoming load-bearing API.
    expect(error.death).toBe("keepAliveUnanswered");

    // One prose check, and it is about the LABEL rather than the diagnosis: the
    // transport `describe` must reach the operator's line.
    expect(error.message).toContain("padi on a starved host");

    // The never-claims. The peer did not exit and its stream did not end, so
    // neither may appear; and the dial-shaped `timeout waiting for "open"` is a
    // lie about a link that was open all along and carried a successful call
    // moments earlier.
    expect(error.message).not.toContain('timeout waiting for "open"');
    expect(error.message).not.toContain("the peer process exited");

    await w.done();
  }, 60_000);
});
