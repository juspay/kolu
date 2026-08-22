/**
 * A peer that goes SILENT but is not dead — the shape that took a production
 * host down (a box at load 67 on 16 cores, its `padi --stdio` front too starved
 * to answer inside Effect RPC's ping window).
 *
 * Effect RPC's `makeProtocolSocket` runs its own pinger, and it is not a knob:
 * `makePinger` writes a ping every 5s and ends the socket run the moment a tick
 * finds the previous ping unanswered — so 5–10s of silence is fatal, regardless
 * of what `@kolu/surface`'s own `heartbeat.ts` watchdog (15s interval, 10s
 * timeout, suspension-aware) would have decided. The lower deadline always wins.
 *
 * That death is reported as `SocketOpenError{kind:"Timeout"}`, whose `message`
 * getter renders the misleading `timeout waiting for "open"` — the same string a
 * failed DIAL produces. On this leg the two cannot be the same fact: `fromDuplex`
 * is handed an ALREADY-OPEN duplex and no `openTimeout`, so a `Timeout` here is
 * only ever the pinger. `wire.ts`'s `neverReconnect` is argued from the dial
 * reading ("a re-dial would re-acquire the SAME dead fds") and is applied to
 * both.
 *
 * What this file measures:
 *
 *  1. the bytes never stop flowing permanently — the pipes are open at both ends
 *     throughout, and the server answers correctly the instant a SHORT stall
 *     lifts. Nothing here is ever a dead fd;
 *  2. a stall past the ping window nevertheless kills the link, irrecoverably;
 *  3. and the diagnosis it dies with names the keep-alive rather than claiming
 *     the peer exited — which is the part this repo can actually fix.
 *
 * On (2), the obvious fix is MEASURED not to work, and the measurement is
 * recorded in `wire.ts` beside `neverReconnect`: `retryTransientErrors: true`
 * plus a spaced schedule (what the websocket leg does) re-acquires the duplex
 * that the socket run's own scope finaliser has already destroyed, so the retry
 * dies on its first write. The link stays dead either way; only the error gets
 * worse. Moving the deadline is not available either — Effect hardcodes the
 * pinger's 5s cadence with no option to tune it.
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
    const error = failure.error as { _tag?: string; message?: string };
    expect(error._tag).toBe("SurfaceStdioTransportClosed");

    // But the diagnosis must describe what happened. The peer never exited and
    // its stream never ended, so neither claim may appear; and the dial-shaped
    // `timeout waiting for "open"` is a lie about a link that was open all
    // along and carried a successful call moments earlier.
    expect(error.message).toContain("stopped answering the keep-alive ping");
    expect(error.message).toContain("padi on a starved host");
    expect(error.message).not.toContain('timeout waiting for "open"');
    expect(error.message).not.toContain("the peer process exited");

    await w.done();
  }, 60_000);
});
