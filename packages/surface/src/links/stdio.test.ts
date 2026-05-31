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

import { eventIterator, oc } from "@orpc/contract";
import { implement } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { serveOverStdio } from "../peer-server";
import { createLoopbackPair } from "./loopback";
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
});
