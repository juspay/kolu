/**
 * Round-trip the stdio link through a loopback PassThrough pair — the same
 * ndjson frames the real ssh subprocess case carries, no fork required.
 *
 * Covers: unary request/response (the trivial path), a STREAMING member (the
 * non-trivial path where the protocol interleaves per-frame pushes with
 * concurrent requests), interruption propagation (the consumer stops pulling,
 * the server's stream finalizes), the stdout-is-protocol gotcha (a stray line
 * on the wire must not wedge the link), and every shape of transport death —
 * each of which must FAIL a call with `SurfaceStdioTransportClosed` rather than
 * hang it or crash the process.
 *
 * The wiring itself — pair, server, banner, link, teardown — is the shared
 * `loopbackWired.testlib` harness, so this file and `stdioPingStall.test.ts`
 * cannot drift about what the honest sequence is.
 */

import { PassThrough } from "node:stream";
import { Effect, Fiber, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { SurfaceStdioTransportClosed } from "../errors";
import { isHalfOpenDispatch } from "../link";
import { createLoopbackPair, greetLoopback } from "../loopback";
import { serveOverStdio } from "../peer-server";
import {
  buildLoopbackRuntime,
  loopbackSurface,
  wiredLoopback,
} from "./loopbackWired.testlib";
import {
  awaitStdioReadiness,
  type StdioReadinessProof,
  writeStdioReadiness,
} from "./readiness";
import { stdioLink } from "./stdio";

/** Greet a bare PassThrough with itself — the minimal honest gate for a test
 *  that never runs a server: the banner really is written and really is read,
 *  it just has no daemon behind it (juspay/kolu#2101). */
function greetSelf(read: PassThrough): Promise<StdioReadinessProof> {
  const proof = awaitStdioReadiness({
    read,
    deadlineMs: 10_000,
    describe: "stdio",
  });
  writeStdioReadiness(read, { verdict: "ready" });
  return proof;
}

describe("stdio link over loopback", () => {
  it("round-trips a unary procedure", async () => {
    const { link, done } = await wiredLoopback();
    await expect(
      Effect.runPromise(
        link.dispatch.unary("surface/math/add", { a: 2, b: 3 }),
      ),
    ).resolves.toBe(5);
    await done();
  });

  it("brands its dispatch half-openable — the face must refuse it without a watchdog (#1564)", async () => {
    const { link, done } = await wiredLoopback();
    expect(isHalfOpenDispatch(link.dispatch)).toBe(true);
    await done();
  });

  it("streams a member's frames across the wire", async () => {
    const { link, done } = await wiredLoopback();
    const frames = await Effect.runPromise(
      Stream.runCollect(
        link.dispatch.stream("surface/counter/get", { to: 4 }) as Stream.Stream<
          { n: number },
          unknown
        >,
      ),
    );
    expect(frames.map((f) => f.n)).toEqual([0, 1, 2, 3]);
    await done();
  });

  it("propagates interruption: the consumer stops pulling, the server's stream finalizes", async () => {
    let finalized = false;
    const { link, done } = await wiredLoopback({
      onFinalize: () => {
        finalized = true;
      },
    });
    const seen: number[] = [];
    const fiber = Effect.runFork(
      Stream.runForEach(
        link.dispatch.stream("surface/counter/get", { to: 0 }) as Stream.Stream<
          { n: number },
          unknown
        >,
        (frame) =>
          Effect.sync(() => {
            seen.push(frame.n);
          }),
      ),
    );
    await expect.poll(() => seen.length, { timeout: 2_000 }).toBeGreaterThan(0);
    await Effect.runPromise(Fiber.interrupt(fiber));
    // The interrupt travels as an RPC Interrupt frame; the server-side stream
    // is then finalized (its `ensuring` runs).
    await expect.poll(() => finalized, { timeout: 2_000 }).toBe(true);
    await done();
  });

  it("does not wedge when the agent corrupts stdout (lesson #4)", async () => {
    const runtime = buildLoopbackRuntime();
    const pair = createLoopbackPair();
    const serving = serveOverStdio({
      group: runtime.group,
      handlers: runtime.handlers,
      transport: pair.server,
    });
    // The gate first (a real agent greets before it can corrupt anything), THEN
    // the corruption: a stray non-ndjson line on the wire from the server side —
    // a pino log line that escaped to stdout. What we forbid is the link
    // WEDGING: the call must settle, either way.
    const readiness = await greetLoopback(pair);
    pair.server.write.write("«this looks like a pino log line»\n");

    const link = await stdioLink({
      group: loopbackSurface.group,
      read: pair.client.read,
      write: pair.client.write,
      readiness,
    });
    const winner = await Promise.race([
      Effect.runPromise(link.dispatch.unary("surface/math/add", { a: 1, b: 1 }))
        .then(() => "ok" as const)
        .catch(() => "err" as const),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 2_000),
      ),
    ]);
    expect(winner).not.toBe("timeout");

    await link.dispose();
    pair.client.write.end();
    pair.server.write.end();
    await serving;
    await runtime.close();
  });

  it("fails an RPC issued after the transport closed, instead of hanging", async () => {
    // Reconnect-wedge regression: a client whose stdio stream has ended (the
    // agent subprocess exited) must FAIL a fresh RPC, not hang. A pump that
    // re-issued a call against such a dead link used to await a response that
    // never arrived and never errored, so the reconnect loop never advanced.
    const { link, pair, serving } = await wiredLoopback();
    await expect(
      Effect.runPromise(
        link.dispatch.unary("surface/math/add", { a: 1, b: 1 }),
      ),
    ).resolves.toBe(2);

    // Agent exits: its stdout (our inbound stream) ends, tearing the link down.
    pair.server.write.end();
    await serving;

    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary("surface/math/add", { a: 1, b: 1 })),
    );
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    await link.dispose();
  });

  it("fails a call PARKED at transport close with the ONE typed transport error (#1719)", async () => {
    // The mechanism fence for #1719: when the transport dies, a parked pull
    // must reject with the single owned, greppable transport error — never an
    // anonymous abort from some queue's internals, which a mirror consumer
    // cannot classify and therefore floats.
    const { link, pair, serving } = await wiredLoopback();
    const parked = Effect.runPromiseExit(
      Stream.runCollect(
        link.dispatch.stream("surface/counter/get", { to: 0 }) as Stream.Stream<
          { n: number },
          unknown
        >,
      ),
    );
    // Let the subscription establish and its first frames arrive.
    await new Promise((r) => setTimeout(r, 50));
    pair.server.write.end();

    const exit = await parked;
    expect(exit._tag).toBe("Failure");
    const rendered = JSON.stringify(exit);
    expect(rendered).toContain("SurfaceStdioTransportClosed");
    await serving;
    await link.dispose();
  });

  it("does not crash when the write stream errors — closes the link instead (EPIPE guard)", async () => {
    // A failed write makes Node emit 'error' on the write stream, and an
    // 'error' with no listener is a hard process crash — not a rejection a
    // consumer can catch. The write stream here is ISOLATED (only the link
    // listens), so removing the guard makes this test die with an uncaught
    // error rather than pass: the green run is genuine evidence.
    const read = new PassThrough(); // inbound — never fed; the link stays open
    const write = new PassThrough(); // outbound — isolated
    const link = await stdioLink({
      group: loopbackSurface.group,
      read,
      write,
      readiness: await greetSelf(read),
    });

    write.destroy(new Error("EPIPE: write to a broken pipe"));
    await new Promise((r) => setImmediate(r));

    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary("surface/math/add", { a: 1, b: 1 })),
    );
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    await link.dispose();
  });

  it("fails a call fast when the write stream was destroyed WITHOUT an error", async () => {
    // destroy() with no error emits NO 'error' event; a later write reports
    // ERR_STREAM_DESTROYED only through its callback. Pre-fix (in the oRPC
    // codec) the link never learned the transport died and the call hung.
    const read = new PassThrough();
    const write = new PassThrough();
    write.destroy(); // silent: no 'error' event ever fires
    const link = await stdioLink({
      group: loopbackSurface.group,
      read,
      write,
      readiness: await greetSelf(read),
    });

    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary("surface/math/add", { a: 1, b: 1 })),
    );
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    await link.dispose();
  });

  it("fails a call issued after dispose(), rather than parking it on a dead protocol", async () => {
    const { link, pair, serving } = await wiredLoopback();
    await link.dispose();
    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary("surface/math/add", { a: 1, b: 1 })),
    );
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    // Close the CLIENT's write half too, exactly as `done()` does — that is what
    // a real parent dropping a link does, and it is what delivers EOF to the
    // agent's stdin. Ending only the server half used to be enough here purely
    // by accident: an un-greeted client stream sat in flowing mode, so the
    // disposed link still drained the server→client PassThrough to EOF. A
    // greeted stream is PAUSED (the readiness read leaves it that way, which is
    // exactly what keeps the first frame from being lost), so nothing drains it
    // after dispose. The pin here is the failed call above; the teardown is
    // teardown, and this is the honest spelling of it.
    pair.client.write.end();
    pair.server.write.end();
    await serving;
  });
});
