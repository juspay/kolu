/**
 * Bounded `deltas` frames — the split of an over-budget collection snapshot (or
 * coalesced delta) into parts, and the reassembly every consumer reads through.
 *
 * The claim this file has to make good on, and what each case pins:
 *
 *   1. a frame UNDER the budget is returned byte-identical, with no `part` marker
 *      — the common case (a small collection) is untouched by the framing;
 *   2. an over-budget frame is split so EVERY part's encoded size is within the
 *      budget — that is the whole point: no single frame may scale with the
 *      number of entries (the olai transcript that starved the ping);
 *   3. the parts REASSEMBLE to exactly the frame that went in, order preserved —
 *      `useCollection` sees what it always saw;
 *   4. the part protocol is total: `seq: 0` restarts, a whole frame clears a
 *      partial, and a gap is refused loudly rather than spliced.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";
import { collectionDeltasSchema, type CollectionDeltasMsg } from "./define";
import {
  deltasSizes,
  reassembleCollectionDeltas,
  splitCollectionDeltas,
} from "./collectionDeltasFraming";

type V = { name: string };
type Msg = CollectionDeltasMsg<number, V>;

const keySchema = Schema.Number;
const valueSchema = Schema.Struct({ name: Schema.String });

/** The sizes a schema implies, measured exactly as the wire would. */
const sizes = deltasSizes<number, V>(keySchema, valueSchema);
const encodeFrame = Schema.encodeUnknownSync(
  collectionDeltasSchema(keySchema, valueSchema),
);
const byteLen = (frame: unknown): number =>
  JSON.stringify(encodeFrame(frame)).length;

const snapshotOf = (n: number): Msg => ({
  kind: "snapshot",
  entries: Array.from(
    { length: n },
    (_, i) => [i, { name: `item-${i}` }] as [number, V],
  ),
});

const deltaOf = (upserts: number, removes: number): Msg => ({
  kind: "delta",
  upserts: Array.from(
    { length: upserts },
    (_, i) => [i, { name: `item-${i}` }] as [number, V],
  ),
  removes: Array.from({ length: removes }, (_, i) => 10_000 + i),
});

/** Drain a stream of frames to an array. */
const collect = <A>(s: Stream.Stream<A, unknown>): Promise<readonly A[]> =>
  Effect.runPromise(Stream.runCollect(s));

describe("splitCollectionDeltas — bounded frames", () => {
  it("returns a small frame UNCHANGED, with no part marker (frozen bytes)", () => {
    const msg = snapshotOf(3);
    const parts = splitCollectionDeltas(msg, sizes);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe(msg);
    expect(parts[0]?.part).toBeUndefined();
  });

  it("splits an over-budget snapshot into parts, NONE larger than the budget", () => {
    const msg = snapshotOf(500);
    // A budget far under the frame's size but far over a single entry.
    const budget = 2 * 1024;
    expect(sizes.frame(msg)).toBeGreaterThan(budget);

    const parts = splitCollectionDeltas(msg, sizes, budget);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      // The real claim: no single outbound frame exceeds the budget.
      expect(byteLen(part)).toBeLessThanOrEqual(budget);
      expect(part.kind).toBe("snapshot");
      if (part.kind === "snapshot") {
        expect(part.part?.of).toBe(parts.length);
      }
    }
    // Every entry is present exactly once, in order.
    const entries = parts.flatMap((p) =>
      p.kind === "snapshot" ? p.entries : [],
    );
    expect(entries).toEqual(msg.kind === "snapshot" ? msg.entries : []);
    parts.forEach((p, seq) => {
      expect(p.part).toEqual({ seq, of: parts.length });
    });
  });

  it("splits an over-budget delta, keeping upserts and removes whole and ordered", () => {
    const msg = deltaOf(400, 60);
    const budget = 2 * 1024;
    const parts = splitCollectionDeltas(msg, sizes, budget);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(byteLen(part)).toBeLessThanOrEqual(budget);

    const upserts = parts.flatMap((p) => (p.kind === "delta" ? p.upserts : []));
    const removes = parts.flatMap((p) => (p.kind === "delta" ? p.removes : []));
    expect(upserts).toEqual(msg.kind === "delta" ? msg.upserts : []);
    expect(removes).toEqual(msg.kind === "delta" ? msg.removes : []);
  });

  it("emits a single item larger than the budget as one honest part (no truncation)", () => {
    const msg: Msg = {
      kind: "snapshot",
      entries: [[1, { name: "x".repeat(500) }]],
    };
    // A budget smaller than one entry: nothing to split further, so it is emitted
    // whole rather than dropped — under the 16 MiB decoder cap regardless.
    const parts = splitCollectionDeltas(msg, sizes, 64);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual(msg);
  });
});

describe("reassembleCollectionDeltas — parts fold back", () => {
  it("reassembles a split snapshot to exactly the original frame", async () => {
    const msg = snapshotOf(500);
    const parts = splitCollectionDeltas(msg, sizes, 2 * 1024);
    const out = await collect(
      reassembleCollectionDeltas(Stream.fromIterable(parts)),
    );
    expect(out).toEqual([msg]);
  });

  it("reassembles a split delta to exactly the original frame", async () => {
    const msg = deltaOf(400, 60);
    const parts = splitCollectionDeltas(msg, sizes, 2 * 1024);
    const out = await collect(
      reassembleCollectionDeltas(Stream.fromIterable(parts)),
    );
    expect(out).toEqual([msg]);
  });

  it("passes whole frames straight through (the un-chunked path is untouched)", async () => {
    const frames: Msg[] = [snapshotOf(2), deltaOf(1, 0)];
    const out = await collect(
      reassembleCollectionDeltas(Stream.fromIterable(frames)),
    );
    expect(out).toEqual(frames);
  });

  it("a whole frame CLEARS a stale partial — a cut-off frame is not spliced onto it", async () => {
    const cut = snapshotOf(500);
    const parts = splitCollectionDeltas(cut, sizes, 2 * 1024);
    const fresh: Msg = {
      kind: "snapshot",
      entries: [[999, { name: "fresh" }]],
    };
    // Part 0 alone (the link died mid-frame), then a whole frame from a fresh
    // subscribe. The stale part must NOT prepend onto the fresh snapshot.
    const out = await collect(
      reassembleCollectionDeltas(Stream.fromIterable([parts[0]!, fresh])),
    );
    expect(out).toEqual([fresh]);
  });

  it("a fresh `seq: 0` RESTARTS rather than appends — retry discards the half", async () => {
    const cut = snapshotOf(500);
    const parts = splitCollectionDeltas(cut, sizes, 2 * 1024);
    // A retried stream re-sends the whole thing from 0.
    const out = await collect(
      reassembleCollectionDeltas(Stream.fromIterable([parts[0]!, ...parts])),
    );
    expect(out).toEqual([cut]);
  });

  it("refuses a gap loudly rather than inventing an order", async () => {
    const cut = snapshotOf(500);
    const parts = splitCollectionDeltas(cut, sizes, 2 * 1024);
    const gapped = [parts[0]!, parts[2]!];
    await expect(
      collect(reassembleCollectionDeltas(Stream.fromIterable(gapped))),
    ).rejects.toThrow(/expected part 1 but received 2/);
  });
});

describe("deltasSizes — measuring a shared frame once", () => {
  it("measures a frame ONCE however many subscribers read it (the bus fans out one object)", () => {
    // Every subscriber's handler runs the fast-path test on the SAME frame object
    // the bus delivered (`inMemoryChannel` fans one value out). Without the memo
    // that is one encode per tab per tick — "per token, per tab". The spy counts
    // the `JSON.stringify` inside the measurement.
    const sizes = deltasSizes<number, V>(keySchema, valueSchema);
    const frame: Msg = {
      kind: "delta",
      upserts: [[1, { name: "a" }]],
      removes: [],
    };
    const spy = vi.spyOn(JSON, "stringify");
    try {
      sizes.frame(frame);
      sizes.frame(frame);
      sizes.frame(frame);
      expect(spy).toHaveBeenCalledTimes(1);
      // A DIFFERENT object is measured afresh — the memo is by identity, not by
      // content, so two frames that happen to look alike are still each measured.
      sizes.frame({
        kind: "delta",
        upserts: [[1, { name: "a" }]],
        removes: [],
      });
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("measures BYTES, not UTF-16 code units — a CJK value is up to 3x larger on the wire", () => {
    const sizes = deltasSizes<number, V>(keySchema, valueSchema);
    const ascii: Msg = { kind: "snapshot", entries: [[1, { name: "aaaa" }]] };
    const cjk: Msg = { kind: "snapshot", entries: [[1, { name: "漢字漢字" }]] };
    // Same JSON CODE-UNIT length (both values are 4 characters) …
    expect(JSON.stringify(ascii).length).toBe(JSON.stringify(cjk).length);
    // … but the CJK value is 3 bytes per character on the wire, so its frame
    // measures strictly larger. A code-unit budget would have called them equal.
    expect(sizes.frame(cjk)).toBeGreaterThan(sizes.frame(ascii));
  });
});

describe("the part budget arithmetic", () => {
  it("keeps the stream budget far under the 16 MiB decoder cap and inside the ping window", async () => {
    // Regression guard for the derivation beside `RPC_STREAM_CHUNK_BYTES`
    // (`frameChunking.ts`): the stream budget is a DRAIN bound (one chunk must
    // drain inside the ping interval so a pong interleaves), and it sits far
    // below the 16 MiB size cap that would only ever be a backstop.
    const { RPC_STREAM_CHUNK_BYTES } = await import("./frameChunking");
    const { RPC_MAX_FRAME_BYTES } = await import("./frameLimit");
    expect(RPC_STREAM_CHUNK_BYTES).toBeLessThanOrEqual(RPC_MAX_FRAME_BYTES / 4);
  });
});
