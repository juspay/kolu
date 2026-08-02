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
 */

import { PassThrough } from "node:stream";
import { Effect, Fiber, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "../define";
import { SurfaceStdioTransportClosed } from "../errors";
import { createLoopbackPair } from "../loopback";
import { serveOverStdio } from "../peer-server";
import { implementSurface } from "../server";
import { stdioLink } from "./stdio";

const surface = defineSurface({
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
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

/** `to: 0` means "emit one frame, then never end" — the probe for "the server
 *  stops producing when the consumer goes away", with an observable finalizer. */
function buildRuntime(onFinalize?: () => void) {
  return implementSurface(surface, {
    procedures: {
      math: { add: ({ input }) => Effect.succeed(input.a + input.b) },
    },
    streams: {
      counter: {
        source: (input) => {
          const frames: Stream.Stream<{ n: number }> =
            input.to === 0
              ? Stream.concat(Stream.make({ n: 0 }), Stream.never)
              : Stream.map(Stream.range(0, input.to - 1), (n) => ({ n }));
          return onFinalize === undefined
            ? frames
            : Stream.ensuring(
                frames,
                Effect.sync(() => onFinalize()),
              );
        },
      },
    },
  });
}

async function wired(onFinalize?: () => void) {
  const runtime = buildRuntime(onFinalize);
  const pair = createLoopbackPair();
  const serving = serveOverStdio({
    group: runtime.group,
    handlers: runtime.handlers,
    transport: pair.server,
  });
  const link = await stdioLink({
    group: surface.group,
    read: pair.client.read,
    write: pair.client.write,
  });
  return {
    link,
    pair,
    serving,
    done: async () => {
      await link.dispose();
      pair.client.write.end();
      pair.server.write.end();
      await serving;
      await runtime.close();
    },
  };
}

describe("stdio link over loopback", () => {
  it("round-trips a unary procedure", async () => {
    const { link, done } = await wired();
    await expect(
      Effect.runPromise(
        link.dispatch.unary("surface/math/add", { a: 2, b: 3 }),
      ),
    ).resolves.toBe(5);
    await done();
  });

  it("streams a member's frames across the wire", async () => {
    const { link, done } = await wired();
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
    const { link, done } = await wired(() => {
      finalized = true;
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
    const runtime = buildRuntime();
    const pair = createLoopbackPair();
    const serving = serveOverStdio({
      group: runtime.group,
      handlers: runtime.handlers,
      transport: pair.server,
    });
    // A stray non-ndjson line on the wire from the server side — a pino log
    // line that escaped to stdout. What we forbid is the link WEDGING: the
    // call must settle, either way.
    pair.server.write.write("«this looks like a pino log line»\n");

    const link = await stdioLink({
      group: surface.group,
      read: pair.client.read,
      write: pair.client.write,
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
    const { link, pair, serving } = await wired();
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
    const { link, pair, serving } = await wired();
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
    const link = await stdioLink({ group: surface.group, read, write });

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
    const link = await stdioLink({ group: surface.group, read, write });

    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary("surface/math/add", { a: 1, b: 1 })),
    );
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    await link.dispose();
  });

  it("fails a call issued after dispose(), rather than parking it on a dead protocol", async () => {
    const { link, pair, serving } = await wired();
    await link.dispose();
    const failure = await Effect.runPromise(
      Effect.flip(link.dispatch.unary("surface/math/add", { a: 1, b: 1 })),
    );
    expect(failure).toBeInstanceOf(SurfaceStdioTransportClosed);
    pair.server.write.end();
    await serving;
  });
});
