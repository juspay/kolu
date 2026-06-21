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
import { mirrorRemoteSurface } from "./mirrorRemoteSurface";

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

    const done = mirrorRemoteSurface(testSurface, asClient(client), {
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
    const done = mirrorRemoteSurface(testSurface, asClient(client), {
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
    });
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
      ),
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("boom"))).toBe(true);
  });
});
