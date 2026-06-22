/**
 * `mirrorRemoteSurface` over a synthetic surface that exercises all four
 * primitive kinds (cell · collection · stream · event) against fake in-process
 * clients — no transport. Proves the consume-side dual of `implementSurface`:
 * each primitive's frames land in its sink, a departed collection key fires
 * `onRemove`, primitives with no sink (or no client entry) are skipped, and a
 * non-abort stream error settles rather than rejecting the whole mirror.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import { directLink } from "./links/direct";
import {
  ClientSurfaceMismatchError,
  mirrorRemoteSurface,
} from "./mirrorRemoteSurface";
import { type Channel, implementSurface, inMemoryChannel } from "./server";

const testSurface = defineSurface({
  cells: { count: { schema: z.number(), default: 0 } },
  collections: {
    items: { keySchema: z.string(), schema: z.object({ v: z.number() }) },
  },
  streams: { ticks: { inputSchema: z.object({}), outputSchema: z.number() } },
  events: { bells: { inputSchema: z.object({}), outputSchema: z.string() } },
});

async function* gen<T>(...vals: T[]): AsyncGenerator<T> {
  for (const v of vals) yield v;
}
const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

// A loose cast for the fake clients — `mirrorRemoteSurface` reads `client.surface`
// structurally, so a partial fake is enough.
// biome-ignore lint/suspicious/noExplicitAny: structural fake client for the test.
const asClient = (c: unknown): any => c;

describe("mirrorRemoteSurface", () => {
  it("mirrors a cell, a collection, a stream, and an event into their sinks", async () => {
    let closeKeys!: () => void;
    const keysOpen = new Promise<void>((r) => {
      closeKeys = r;
    });
    const client = {
      surface: {
        count: { get: async () => gen(1, 2, 3) },
        items: {
          // Keys snapshot then stay open (a real keys stream is long-lived),
          // so the per-key value streams have time to deliver before we close.
          keys: async () =>
            (async function* () {
              yield ["a", "b"];
              await keysOpen;
            })(),
          get: async ({ key }: { key: string }) =>
            gen({ v: key === "a" ? 10 : 20 }),
        },
        ticks: { get: async () => gen(10, 20) },
        bells: { get: async () => gen("ding") },
      },
    };

    const cellFrames: number[] = [];
    const upserts: Array<[string, { v: number }]> = [];
    const streamFrames: number[] = [];
    const eventFrames: string[] = [];

    const { done } = mirrorRemoteSurface(testSurface, asClient(client), {
      cells: { count: (v) => cellFrames.push(v) },
      collections: {
        items: {
          upsert: (k, v) => upserts.push([k, v]),
          remove: () => {},
        },
      },
      streams: { ticks: { input: {}, onFrame: (n) => streamFrames.push(n) } },
      events: { bells: { input: {}, onFrame: (s) => eventFrames.push(s) } },
    });

    await delay(20);
    expect(cellFrames).toEqual([1, 2, 3]);
    expect(streamFrames).toEqual([10, 20]);
    expect(eventFrames).toEqual(["ding"]);
    expect([...upserts].sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ["a", { v: 10 }],
      ["b", { v: 20 }],
    ]);

    closeKeys();
    await done; // every subscription settled (keys closed) → the mirror resolves.
  });

  it("fires onRemove when a key leaves the collection's keys snapshot", async () => {
    let closeKeys!: () => void;
    const keysOpen = new Promise<void>((r) => {
      closeKeys = r;
    });
    let closeVals!: () => void;
    const valsOpen = new Promise<void>((r) => {
      closeVals = r;
    });
    const client = {
      surface: {
        items: {
          keys: async () =>
            (async function* () {
              yield ["a", "b"];
              await delay(5);
              yield ["a"]; // b departs
              await keysOpen;
            })(),
          // Per-key value streams stay open so a key is "present" until removed.
          get: async ({ key }: { key: string }) =>
            (async function* () {
              yield { v: key === "a" ? 1 : 2 };
              await valsOpen;
            })(),
        },
      },
    };

    const upserts: string[] = [];
    const removes: string[] = [];
    const { done } = mirrorRemoteSurface(testSurface, asClient(client), {
      collections: {
        items: {
          upsert: (k) => upserts.push(k),
          remove: (k) => removes.push(k),
        },
      },
    });

    await delay(30);
    expect([...upserts].sort()).toEqual(["a", "b"]);
    expect(removes).toEqual(["b"]);

    closeVals();
    closeKeys();
    await done;
  });

  it("subscribes only the opted-in primitives and tolerates a missing client entry", async () => {
    // The client serves only `count`; the sink opts into only `count`. The other
    // three primitives (no sink) are skipped, and the missing client entries are
    // never touched — no throw.
    const client = { surface: { count: { get: async () => gen(7) } } };
    const cellFrames: number[] = [];
    await mirrorRemoteSurface(testSurface, asClient(client), {
      cells: { count: (v) => cellFrames.push(v) },
    }).done;
    expect(cellFrames).toEqual([7]);
  });

  it("settles (does not reject) when a stream errors, and logs it", async () => {
    const client = {
      surface: {
        ticks: {
          get: async () => {
            throw new Error("boom");
          },
        },
      },
    };
    const logs: string[] = [];
    await expect(
      mirrorRemoteSurface(
        testSurface,
        asClient(client),
        { streams: { ticks: { input: {}, onFrame: () => {} } } },
        { log: (l) => logs.push(l) },
      ).done,
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("boom"))).toBe(true);
  });

  it("rejects (does not log/swallow) when a stream SINK throws — fail-fast", async () => {
    // A throw from the caller's `onFrame` is a broken local fold, not an upstream
    // blip: it must reject the whole mirror (no-fallback: a caught error can't
    // collapse to a quietly-resolved mirror), and never be hidden as a logged
    // remote-stream error — even when the logger is a no-op.
    const client = { surface: { ticks: { get: async () => gen(1) } } };
    const logs: string[] = [];
    await expect(
      mirrorRemoteSurface(
        testSurface,
        asClient(client),
        {
          streams: {
            ticks: {
              input: {},
              onFrame: () => {
                throw new Error("fold blew up");
              },
            },
          },
        },
        { log: (l) => logs.push(l) },
      ).done,
    ).rejects.toThrow("fold blew up");
    // The sink failure was NOT logged as an upstream blip.
    expect(logs.some((l) => l.includes("fold blew up"))).toBe(false);
  });

  it("rejects when a collection UPSERT sink throws — fail-fast", async () => {
    const client = {
      surface: {
        items: {
          keys: async () =>
            (async function* () {
              yield ["a"];
              await delay(50); // stay open; the sink throw ends the mirror first.
            })(),
          get: async () => gen({ v: 1 }),
        },
      },
    };
    await expect(
      mirrorRemoteSurface(testSurface, asClient(client), {
        collections: {
          items: {
            upsert: () => {
              throw new Error("upsert fold blew up");
            },
            remove: () => {},
          },
        },
      }).done,
    ).rejects.toThrow("upsert fold blew up");
  });

  it("rejects (does not no-op) when a sink is supplied but the client lacks the entry", async () => {
    // Omitting a sink is non-interest; SUPPLYING one for a primitive the client
    // doesn't expose is a client/surface mismatch — fail-fast, never silent
    // no-data while the caller still thinks it's connected.
    const client = { surface: {} };
    await expect(
      mirrorRemoteSurface(testSurface, asClient(client), {
        cells: { count: () => {} },
      }).done,
    ).rejects.toThrow(/client\/surface mismatch/);
  });

  it("starts NO subscription when a later opted-in primitive fails validation", async () => {
    // Setup is all-or-nothing: a valid earlier sink (the cell) must not begin
    // subscribing if a later opted-in sink (the stream) has no client entry. If
    // setup started tasks before validating everything, the cell's long-lived
    // subscription would keep pushing frames into the sink after the caller already
    // observed the rejection.
    let cellSubscribed = false;
    const client = {
      surface: {
        // A valid cell entry, declared first so its `start` would run first…
        count: {
          get: async () => {
            cellSubscribed = true;
            return gen(1, 2, 3);
          },
        },
        // …but `ticks` is absent, so validating the stream sink throws.
      },
    };
    await expect(
      mirrorRemoteSurface(testSurface, asClient(client), {
        cells: { count: () => {} },
        streams: { ticks: { input: {}, onFrame: () => {} } },
      }).done,
    ).rejects.toThrow(/client\/surface mismatch/);
    // Give any erroneously-started task a tick to call `get`.
    await delay(10);
    expect(cellSubscribed).toBe(false);
  });
});

// ── Procedures — the pull-side half of the total dual ─────────────────────
//
// A streaming primitive is PUSH (frames flow into a sink); a procedure is PULL
// (a local call runs on the remote and returns). So procedures don't live in the
// SurfaceSink — they come back as forwarding stubs on `mirrorRemoteSurface`'s
// return (`{ procedures, done }`). These tests pin that the stubs forward, that
// `serve ∘ mirror ≈ identity` holds once a re-served surface grafts them, and
// that a missing client entry fails loud (no silent undefined).

const procSurface = defineSurface({
  procedures: {
    math: {
      double: {
        input: z.object({ x: z.number() }),
        output: z.object({ y: z.number() }),
      },
      // no input — exercises the void-input forwarder shape.
      ping: { output: z.object({ pong: z.boolean() }) },
      // no output — exercises the void-output forwarder shape.
      reset: { input: z.object({ to: z.number() }) },
    },
  },
});

/** Serve `procSurface` over an in-process `directLink` — the "remote" the mirror
 *  consumes. `recordedResets` lets a test assert a no-output procedure actually
 *  ran on the far side. */
function serveProc(recordedResets: number[] = []) {
  const { router } = implementSurface(procSurface, {
    channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
    procedures: {
      math: {
        double: ({ input }) => ({ y: input.x * 2 }),
        ping: () => ({ pong: true }),
        reset: ({ input }) => {
          recordedResets.push(input.to);
        },
      },
    },
  });
  return directLink<typeof procSurface.contract>(router);
}

describe("mirrorRemoteSurface — procedures (the total dual)", () => {
  it("forwards each procedure kind (in+out, no-input, no-output) to the remote", async () => {
    const resets: number[] = [];
    const mirror = mirrorRemoteSurface(procSurface, serveProc(resets), {});

    expect(await mirror.procedures.math.double({ x: 21 })).toEqual({ y: 42 });
    expect(await mirror.procedures.math.ping()).toEqual({ pong: true });
    await expect(
      mirror.procedures.math.reset({ to: 7 }),
    ).resolves.toBeUndefined();
    expect(resets).toEqual([7]); // the no-output call actually ran on the far side
  });

  it("serve ∘ mirror ≈ identity — a re-served forwarded procedure round-trips", async () => {
    // Mirror the remote, then RE-SERVE the mirror by grafting its forwarders into
    // a second `implementSurface`. The re-served surface must behave like the
    // remote — the location-transparency the whole epic rests on.
    const mirror = mirrorRemoteSurface(procSurface, serveProc(), {});
    const { router: reRouter } = implementSurface(procSurface, {
      channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
      procedures: {
        math: {
          double: ({ input }) => mirror.procedures.math.double(input),
          ping: () => mirror.procedures.math.ping(),
          reset: ({ input }) => mirror.procedures.math.reset(input),
        },
      },
    });
    const reServed = directLink<typeof procSurface.contract>(reRouter);
    expect(await reServed.surface.math.double({ x: 21 })).toEqual({ y: 42 });
    expect(await reServed.surface.math.ping()).toEqual({ pong: true });
  });

  it("mirrors a stream into a sink AND forwards a procedure in one call", async () => {
    // The headline: one declarative call drives BOTH halves of the dual — the
    // streaming sink (push) and the procedure forwarder (pull) — over one client.
    const mixed = defineSurface({
      streams: {
        ticks: {
          inputSchema: z.object({ n: z.number() }),
          outputSchema: z.object({ i: z.number() }),
        },
      },
      procedures: {
        math: {
          double: {
            input: z.object({ x: z.number() }),
            output: z.object({ y: z.number() }),
          },
        },
      },
    });
    const { router } = implementSurface(mixed, {
      channel: <T>(_n: string): Channel<T> => inMemoryChannel<T>(),
      streams: {
        ticks: {
          source: async function* (input) {
            for (let i = 0; i < input.n; i++) yield { i };
          },
        },
      },
      procedures: { math: { double: ({ input }) => ({ y: input.x * 2 }) } },
    });
    const client = directLink<typeof mixed.contract>(router);

    const frames: number[] = [];
    const mirror = mirrorRemoteSurface(mixed, client, {
      streams: { ticks: { input: { n: 3 }, onFrame: (f) => frames.push(f.i) } },
    });
    expect(await mirror.procedures.math.double({ x: 4 })).toEqual({ y: 8 });
    await mirror.done; // the ticks stream yielded 3 frames then closed → settles.
    expect(frames).toEqual([0, 1, 2]);
  });

  it("a forwarder for a procedure the client lacks rejects (client/surface mismatch)", async () => {
    // Omitting a streaming sink is non-interest; a procedure stub is always
    // present (the dual is total), but calling one the client doesn't expose is a
    // mismatch — it must reject loudly, never resolve to undefined.
    const client = { surface: {} };
    const mirror = mirrorRemoteSurface(procSurface, asClient(client), {});
    await expect(mirror.procedures.math.double({ x: 1 })).rejects.toThrow(
      /client\/surface mismatch/,
    );
    // The lazy procedure channel and the eager streaming channel throw the SAME
    // type, so a consumer can `instanceof`-discriminate the one fault regardless
    // of which promise delivered it.
    await expect(
      mirror.procedures.math.double({ x: 1 }),
    ).rejects.toBeInstanceOf(ClientSurfaceMismatchError);
  });

  it("exposes an empty procedures map for a surface with no procedures", () => {
    const client = { surface: { count: { get: async () => gen(0) } } };
    const mirror = mirrorRemoteSurface(testSurface, asClient(client), {
      cells: { count: () => {} },
    });
    expect(mirror.procedures).toEqual({});
  });

  // F1 (R7 breaking change): the return is the plain handle `{ procedures, done }`,
  // NOT a thenable. A stale consumer that kept the old `await mirrorRemoteSurface(...)`
  // form must NOT silently get the old settle semantics — `await handle` resolves to
  // the handle itself at once and does not wait for the link to close. The settle is
  // `.done`. This pins that contract in CI so nobody re-introduces a back-compat
  // thenable shim (which `await` would silently honour, hiding the changed contract)
  // and so the doc note's claim is machine-checked, not just prose.
  it("returns a non-thenable handle — a bare `await` does NOT wait for the link", async () => {
    // A stream that stays OPEN: `done` must still be pending after a bare await, so
    // the bare await provably did not wait for the link to close.
    let closeTicks!: () => void;
    const ticksOpen = new Promise<void>((r) => {
      closeTicks = r;
    });
    const client = {
      surface: {
        ticks: {
          get: async () =>
            (async function* () {
              yield 0;
              await ticksOpen;
            })(),
        },
      },
    };
    const handle = mirrorRemoteSurface(testSurface, asClient(client), {
      streams: { ticks: { input: {}, onFrame: () => {} } },
    });

    // The handle is not a promise — `await` on it is the identity, not a settle.
    expect(typeof (handle as { then?: unknown }).then).toBe("undefined");
    const awaited = await handle;
    expect(awaited).toBe(handle); // `await` gave back the object, not `undefined`

    // The link is still open, so the REAL settle (`.done`) is still pending — proof
    // the bare await did not behave like the old `Promise<void>` return.
    let settled = false;
    void handle.done.then(() => {
      settled = true;
    });
    await delay(10);
    expect(settled).toBe(false);

    closeTicks();
    await handle.done; // now the link closed → `.done` settles
    expect(settled).toBe(true);
  });
});
