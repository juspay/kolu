/**
 * Round-trip the stdio link through a loopback PassThrough pair — same
 * framing as the real ssh subprocess case, no fork required.
 *
 * Covers: request/response (the trivial path), async iterators (the
 * non-trivial path where the peer framing has to interleave per-yield
 * EVENT_ITERATOR messages with concurrent requests), abort propagation
 * (the client aborts mid-iteration, the server stops yielding), and the
 * stdout-is-protocol gotcha (lesson #4) — when the agent corrupts the
 * wire with a stray write, the client surfaces the framing error rather
 * than hanging.
 */

import { PassThrough, Writable } from "node:stream";
import { eventIterator, oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLoopbackPair } from "../loopback";
import { serveOverStdio } from "../peer-server";
import { stdioLink } from "./stdio";

describe("stdio link over loopback", () => {
  it("round-trips a simple query procedure", async () => {
    const contract = {
      add: oc
        .input(z.object({ a: z.number(), b: z.number() }))
        .output(z.number()),
    };
    const t = implement(contract);
    const router = t.router({
      add: t.add.handler(({ input }) => input.a + input.b),
    });

    const pair = createLoopbackPair();
    const serveDone = serveOverStdio({
      router,
      transport: pair.server,
    });

    const client = stdioLink<typeof contract>({
      read: pair.client.read,
      write: pair.client.write,
    });

    const result = await client.add({ a: 2, b: 3 });
    expect(result).toBe(5);

    pair.client.write.end();
    pair.server.write.end();
    await serveDone;
  });

  it("streams async iterators per-yield across the wire", async () => {
    const contract = {
      counter: oc
        .input(z.object({ to: z.number() }))
        .output(eventIterator(z.object({ n: z.number() }))),
    };
    const t = implement(contract);
    const router = t.router({
      counter: t.counter.handler(async function* ({ input }) {
        for (let n = 0; n < input.to; n++) yield { n };
      }),
    });

    const pair = createLoopbackPair();
    const serveDone = serveOverStdio({
      router,
      transport: pair.server,
    });

    const client = stdioLink<typeof contract>({
      read: pair.client.read,
      write: pair.client.write,
    });

    const seen: number[] = [];
    const iterable = await client.counter({ to: 4 });
    for await (const v of iterable) seen.push(v.n);
    expect(seen).toEqual([0, 1, 2, 3]);

    pair.client.write.end();
    pair.server.write.end();
    await serveDone;
  });

  it("fires onFirstRequest after the first inbound frame is decoded", async () => {
    const contract = {
      ping: oc.input(z.object({})).output(z.string()),
    };
    const t = implement(contract);
    const router = t.router({
      ping: t.ping.handler(() => "pong"),
    });

    const pair = createLoopbackPair();
    let firstSeen = false;
    const serveDone = serveOverStdio({
      router,
      transport: pair.server,
      onFirstRequest: () => {
        firstSeen = true;
      },
    });

    expect(firstSeen).toBe(false);
    const client = stdioLink<typeof contract>({
      read: pair.client.read,
      write: pair.client.write,
    });
    await client.ping({});
    expect(firstSeen).toBe(true);

    pair.client.write.end();
    pair.server.write.end();
    await serveDone;
  });

  it("does not wedge when the agent corrupts stdout (lesson #4)", async () => {
    const contract = {
      ping: oc.input(z.object({})).output(z.string()),
    };
    const t = implement(contract);
    const router = t.router({
      ping: t.ping.handler(() => "pong"),
    });

    const pair = createLoopbackPair();
    const serveDone = serveOverStdio({
      router,
      transport: pair.server,
    });

    // Reproduce lesson #4: a stray non-base64 line on the wire from the
    // server side. The peer codec attempts to base64-decode it and the
    // bytes won't be valid framing.
    pair.server.write.write("«this looks like a pino log line»\n");

    const client = stdioLink<typeof contract>({
      read: pair.client.read,
      write: pair.client.write,
    });

    // What we forbid is the link wedging indefinitely.
    const timeoutMs = 1000;
    const winner = await Promise.race([
      client
        .ping({})
        .then(() => "ok" as const)
        .catch(() => "err" as const),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), timeoutMs),
      ),
    ]);
    expect(winner).not.toBe("timeout");

    pair.client.write.end();
    pair.server.write.end();
    await serveDone;
  });

  it("propagates abort: client aborts mid-iteration, server stops yielding", async () => {
    const contract = {
      forever: oc
        .input(z.object({}))
        .output(eventIterator(z.object({ n: z.number() }))),
    };
    const t = implement(contract);
    let stopped = false;
    const router = t.router({
      forever: t.forever.handler(async function* () {
        try {
          for (let n = 0; ; n++) {
            yield { n };
            await new Promise((r) => setTimeout(r, 10));
          }
        } finally {
          stopped = true;
        }
      }),
    });

    const pair = createLoopbackPair();
    const serveDone = serveOverStdio({
      router,
      transport: pair.server,
    });

    const client = stdioLink<typeof contract>({
      read: pair.client.read,
      write: pair.client.write,
    });

    const controller = new AbortController();
    const iterable = await client.forever({}, { signal: controller.signal });
    const seen: number[] = [];
    try {
      for await (const v of iterable) {
        seen.push(v.n);
        if (seen.length >= 3) controller.abort();
      }
    } catch {
      /* expected: abort surfaces as a rejection */
    }
    expect(seen.length).toBeGreaterThanOrEqual(3);
    // Give the agent a tick to receive the abort signal.
    await new Promise((r) => setTimeout(r, 50));
    expect(stopped).toBe(true);

    pair.client.write.end();
    pair.server.write.end();
    await serveDone;
  });

  it("rejects an RPC issued after the transport has closed, instead of hanging", async () => {
    // Reconnect-wedge regression: a client whose stdio stream has ended
    // (the agent subprocess exited) must FAIL a fresh RPC, not hang. In
    // the parent's reconnect bridge, a pump that re-issued `system.get`
    // against such a dead client used to await a response that never
    // arrived and never errored — so `Promise.allSettled` never resolved,
    // the reconnect loop never advanced, and every respawned agent sat
    // idle until the connect watchdog reaped it.
    const contract = {
      ping: oc.input(z.object({})).output(z.string()),
    };
    const t = implement(contract);
    const router = t.router({ ping: t.ping.handler(() => "pong") });

    const pair = createLoopbackPair();
    const serveDone = serveOverStdio({ router, transport: pair.server });
    const client = stdioLink<typeof contract>({
      read: pair.client.read,
      write: pair.client.write,
    });

    // Link is live — one good round-trip first.
    expect(await client.ping({})).toBe("pong");

    // Agent exits: its stdout (our inbound stream) ends, tearing the link
    // down. Let `readFramedLines` observe 'end' before the next call so
    // this exercises the "issued after close" path, not an in-flight race.
    pair.server.write.end();
    await new Promise((r) => setImmediate(r));

    await expect(client.ping({})).rejects.toThrow();

    pair.client.write.end();
    await serveDone;
  });

  it("does not crash when the write stream errors — closes the link instead (EPIPE guard)", async () => {
    // Write-side teardown regression: the link writes outbound frames to a
    // stream that can die under it (the ssh pipe drops, the peer exits and
    // our `write` is its now-closed stdin). A failed write makes Node emit
    // 'error' on the write stream, and an 'error' with no listener is a hard
    // process crash — not a rejection a consumer can catch. A coordinator
    // that destroyed its lane mid-write used to be felled by exactly this.
    // The link must instead treat the write death as transport death and
    // close itself, so a fresh RPC rejects fast rather than the process
    // crashing.
    //
    // The write stream here is ISOLATED — a standalone Writable whose ONLY
    // 'error' listener is the link's own guard — deliberately NOT a
    // `createLoopbackPair()`. In a loopback pair the client's write IS the
    // server's read, and `serveOverStdio` attaches a read-side 'error'
    // listener to that same stream; that listener would absorb the destroy
    // and the test would pass even with the link's guard removed, proving
    // nothing. With an isolated write stream, removing the guard makes
    // `destroy(err)` an uncaught 'error' that crashes this test — so the
    // green run is genuine evidence the guard is load-bearing.
    // biome-ignore lint/correctness/noUnusedVariables: read only as a type via `typeof contract` below — this test drives the link itself, not the contract value, so the runtime binding is intentionally unused.
    const contract = {
      ping: oc.input(z.object({})).output(z.string()),
    };

    const read = new PassThrough(); // inbound — never fed; the link stays open
    const write = new PassThrough(); // outbound — isolated; only the link listens
    const client = stdioLink<typeof contract>({ read, write });

    // The write half dies under us. With no guard this 'error' is unhandled
    // (an uncaught error that fails the test); with it the link closes. Let
    // the event settle before the next call.
    write.destroy(new Error("EPIPE: write to a broken pipe"));
    await new Promise((r) => setImmediate(r));

    // The link is now closed: a fresh RPC rejects fast rather than hanging
    // (or crashing).
    await expect(client.ping({})).rejects.toThrow();
  });

  it("does not crash when a fire-and-forget teardown send hits a dead pipe (#32)", async () => {
    // The #32 residual: #25 closed the stream-'error' path, but a send whose
    // promise nobody awaits — oRPC's abort frame, an event-iterator cleanup —
    // still rejected when the pipe was already gone. That rejection was
    // rethrown via process.nextTick as an uncaught exception that crashed the
    // coordinator on teardown after a green run. The request frame goes out
    // fine; the abort frame that follows hits a now-dead write. With
    // `framedSend` the dead-pipe write resolves, so nothing escapes.
    //
    // The guard is the same one the EPIPE-guard test above relies on: an
    // uncaught error during a test fails the run, so the green run IS the
    // evidence nothing escaped — strip the `.catch` in `framedSend` and this
    // test errors with the exact teardown-time `write EPIPE`.
    const contract = { ping: oc.input(z.object({})).output(z.string()) };

    const read = new PassThrough(); // never fed — the request stays in flight
    let writes = 0;
    const write = new Writable({
      write(_chunk, _enc, cb) {
        writes += 1;
        // First write (the request frame) flushes; the next — the abort frame,
        // sent fire-and-forget by the peer — hits a dead pipe.
        if (writes === 1) return cb();
        cb(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
      },
    });
    write.on("error", () => {}); // the link attaches exactly such a guard

    const client = stdioLink<typeof contract>({ read, write });
    const controller = new AbortController();
    const call = client.ping({}, { signal: controller.signal });
    await new Promise((r) => setImmediate(r)); // let the request frame flush
    controller.abort(); // fire-and-forget abort send → 2nd write → EPIPE

    // The call itself rejects (the transport is dead); what must NOT happen is
    // the abort send's rejection escaping as an uncaught exception.
    await expect(call).rejects.toThrow();
    // Give a would-be escaped throw time to surface (and fail this test).
    await new Promise((r) => setTimeout(r, 50));
  });
});
