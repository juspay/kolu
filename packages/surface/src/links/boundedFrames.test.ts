/**
 * Bounded frames over a REAL slow wire — the measurement behind
 * `RPC_STREAM_CHUNK_BYTES` and `collectionDeltasFraming`.
 *
 * The defect (olai's transcript): a collection's `deltas` snapshot is ONE frame
 * carrying the whole set, and on a slow link the server is still pushing it when
 * Effect's pinger's next tick finds its previous ping unanswered — so the socket
 * dies, the link redials, the whole snapshot is re-sent, forever. Every other
 * subscription multiplexed on that socket queues behind the big frame too.
 *
 * This file measures the fix on a loopback stdio pair whose server→client
 * direction is THROTTLED to a fixed byte rate — the in-process shape of a
 * cellular tether. Two claims, both only true if the snapshot is actually split
 * into ack-gated parts:
 *
 *   1. the whole snapshot still ARRIVES, intact — every entry, in order;
 *   2. a small subscription opened on the SAME socket after the big one gets its
 *      first frame BEFORE the snapshot finishes arriving. That interleaving is
 *      impossible while one frame holds the socket: the small frame would sit in
 *      the write queue behind ~a megabyte.
 *
 * The pinger is deliberately NOT faked: the snapshot is delivered slowly enough
 * to outlast Effect's ping interval, so a regression that re-sent it as one frame
 * would starve the pong and kill this link before the assertions run.
 */

import { PassThrough } from "node:stream";
import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { buildSurfaceFace } from "../client";
import { type CollectionDeltasMsg, defineSurface } from "../define";
import { RPC_STREAM_CHUNK_BYTES } from "../frameChunking";
import { serveOverStdio } from "../peer-server";
import { implementSurface } from "../server";
import { awaitStdioReadiness, writeStdioReadiness } from "./readiness";
import { stdioLink } from "./stdio";

/** A `Readable` that replays `src` at, at most, `bytesPerSecond` — one pump tick
 *  every 25ms. `src` is drained into an in-memory queue (a test-scale snapshot is
 *  a few MB, so buffering it costs nothing) and released at the throttled rate,
 *  which is the whole point: the far end's reads are paced. */
function throttleReadable(
  src: PassThrough,
  bytesPerSecond: number,
): PassThrough {
  const out = new PassThrough();
  const tickMs = 25;
  const perTick = Math.max(1, Math.floor((bytesPerSecond * tickMs) / 1000));
  const queue: Buffer[] = [];
  let offset = 0;
  src.on("data", (chunk: Buffer) => queue.push(chunk));
  const pump = (): void => {
    if (out.destroyed) return;
    let budget = perTick;
    while (budget > 0 && queue.length > 0) {
      const head = queue[0]!;
      const take = Math.min(budget, head.length - offset);
      out.write(head.subarray(offset, offset + take));
      offset += take;
      budget -= take;
      if (offset >= head.length) {
        queue.shift();
        offset = 0;
      }
    }
    setTimeout(pump, tickMs);
  };
  pump();
  return out;
}

type V = { text: string };

/** How many entries the snapshot carries, and how long each value is: chosen so
 *  the encoded snapshot spans several `RPC_STREAM_CHUNK_BYTES` parts (the frame
 *  that starved the ping on a slow link). ~1000 entries × ~1 KiB ≈ 1 MiB. */
const ENTRIES = 1_000;
const TEXT = "x".repeat(1_000);
/** A tether-ish rate: one 256 KiB chunk drains in ~1s, the whole ~1 MiB snapshot
 *  in ~4s — comfortably past the 5s ping interval, so an unchunked frame would
 *  starve the pong and kill the link. */
const BYTES_PER_SECOND = 250 * 1024;

const surface = defineSurface({
  collections: {
    items: {
      keySchema: Schema.Number,
      schema: Schema.Struct({ text: Schema.String }),
      verbs: ["keys", "get", "upsert", "delete", "deltas"],
    },
  },
  streams: {
    pulse: {
      inputSchema: Schema.Struct({}),
      outputSchema: Schema.Struct({ n: Schema.Number }),
    },
  },
});

/** Serve `surface` with `ENTRIES` rows already present, over a fresh throttled
 *  loopback pair. */
async function serveThrottled() {
  const items = new Map<number, V>(
    Array.from({ length: ENTRIES }, (_, i) => [i, { text: TEXT }]),
  );
  const runtime = implementSurface(surface, {
    collections: {
      items: {
        readAll: () => items,
        upsert: (k, v) => {
          items.set(k, v);
        },
        remove: (k) => {
          items.delete(k);
        },
      },
    },
    streams: {
      pulse: { source: () => Stream.make({ n: 1 }) },
    },
  });

  const clientToServer = new PassThrough();
  const serverToClient = new PassThrough();
  const clientRead = throttleReadable(serverToClient, BYTES_PER_SECOND);

  const serving = serveOverStdio({
    group: runtime.group,
    handlers: runtime.handlers,
    transport: { read: clientToServer, write: serverToClient },
  });
  const readiness = awaitStdioReadiness({
    read: clientRead,
    deadlineMs: 10_000,
    describe: "throttled loopback",
  });
  writeStdioReadiness(serverToClient, { verdict: "ready" });
  const link = await stdioLink({
    group: surface.group,
    read: clientRead,
    write: clientToServer,
    readiness: await readiness,
  });
  return {
    link,
    done: async () => {
      await link.dispose();
      clientToServer.end();
      serverToClient.end();
      await serving;
      await runtime.close();
    },
  };
}

describe("bounded collection frames over a throttled wire", () => {
  it("the whole snapshot arrives intact while a small subscription on the same socket is served FIRST", async () => {
    const { link, done } = await serveThrottled();
    try {
      const face = buildSurfaceFace(surface, link.dispatch);
      const startedAt = Date.now();
      const deltas = face.surface.items?.deltas as unknown as (
        input: undefined,
      ) => Stream.Stream<CollectionDeltasMsg<number, V>, unknown>;
      const pulse = face.surface.pulse?.get as unknown as (
        input: unknown,
      ) => Stream.Stream<{ n: number }, unknown>;

      // The big subscription first — it is the one holding the socket.
      let bigAt = 0;
      const big = Effect.runPromise(
        Stream.runCollect(Stream.take(deltas(undefined), 1)).pipe(
          Effect.map((frames) => {
            bigAt = Date.now() - startedAt;
            return frames;
          }),
        ),
      );

      // …then a tiny one, a moment later, on the SAME socket. The delay is
      // load-bearing: the big subscription must be the one already holding the
      // socket when the small request lands, or the small frame would go first
      // and the interleaving claim would prove nothing.
      await new Promise((r) => setTimeout(r, 200));
      let smallAt = 0;
      const small = Effect.runPromise(
        Stream.runForEach(pulse({}), () =>
          Effect.sync(() => {
            smallAt = Date.now() - startedAt;
          }),
        ),
      );

      const frames = await big;
      await small;

      // (1) Integrity: the snapshot reassembled to every entry, in server order.
      expect(frames).toHaveLength(1);
      const snapshot = frames[0]!;
      expect(snapshot.kind).toBe("snapshot");
      if (snapshot.kind !== "snapshot") throw new Error("unreachable");
      expect(snapshot.entries).toHaveLength(ENTRIES);
      expect(snapshot.entries[0]).toEqual([0, { text: TEXT }]);
      expect(snapshot.entries[ENTRIES - 1]).toEqual([
        ENTRIES - 1,
        { text: TEXT },
      ]);
      // It really was over the budget — this is the frame that used to starve.
      expect(JSON.stringify(snapshot).length).toBeGreaterThan(
        RPC_STREAM_CHUNK_BYTES,
      );

      // (2) Interleaving: the small frame landed WHILE the snapshot was still
      // arriving. This is the property chunking buys — one frame would have
      // queued the small frame behind the whole snapshot.
      expect(bigAt).toBeGreaterThan(1_500);
      expect(smallAt).toBeGreaterThan(0);
      expect(smallAt).toBeLessThan(bigAt);
    } finally {
      await done();
    }
  }, 30_000);
});
