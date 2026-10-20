/**
 * Bounded `deltas` frames — the sender's half of the collection snapshot budget,
 * and the receiver's reassembly of it.
 *
 * ## The defect this exists for
 *
 * A collection's batched `deltas` stream leads with ONE `{kind:"snapshot",
 * entries}` frame carrying the WHOLE set (`server.ts`'s `collectionHandlers`).
 * For a long conversation (olai's transcript) that frame is several MB, and
 * every subscribe and every reconnect sends it again. It rides the SAME socket as
 * Effect's keep-alive, so on a slow link the frame the server is still pushing
 * when the pinger's next tick fires takes the whole connection down — and with it
 * every unrelated subscription multiplexed on that socket (`./frameLimit.ts` has
 * the frame-cap incident; `./keepAlive.ts` the ping deadline). The fix is to stop
 * letting a single frame scale with user content: the snapshot (and any coalesced
 * delta whose upsert set is large) is split into bounded parts, and the parts are
 * reassembled here so every consumer sees exactly the frames it saw before.
 *
 * ## Why the framing lives HERE and not in the schema
 *
 * The split is a WIRE detail; `CollectionDeltasMsg` (the consumer's type) is
 * unchanged. A part is the SAME arm as a whole frame with an OPTIONAL `part`
 * marker ({@link CollectionDeltaPart}) — so a whole frame's bytes are
 * byte-identical to today's (`collectionDeltasSchema.test.ts` pins that), and a
 * consumer that never sees a `part` (a small collection, a payload under the
 * budget) behaves exactly as it always did. {@link reassembleCollectionDeltas}
 * is the ONE reader that folds parts back, applied at the client face
 * (`client.ts`'s `buildSurfaceFace`) so no consumer — `useCollection`,
 * `mirrorRemoteSurface`, a `SurfaceMap` fold — has to know parts exist.
 *
 * ## The part contract
 *
 * `seq` is 0-based and `of` is the total. Parts of one frame are CONTIGUOUS on
 * the stream (the server emits them back to back, and the ack-gated protocol
 * sends one at a time), so a reader only ever holds one partial frame. A `seq: 0`
 * always resets the buffer — that is what makes a retry (a fresh snapshot
 * beginning at 0) discard a half-received predecessor rather than splice two
 * frames together. Any other discontinuity — a `seq > 0` with no buffer, a
 * repeat, or one whose arm disagrees with the buffer's — is a bug (a lost part,
 * two frames spliced), and {@link reassembleCollectionDeltas} REFUSES it loudly
 * rather than invent an order the wire never had.
 */

import { Schema, Stream } from "effect";
import {
  type CollectionDeltasMsg,
  collectionDeltasSchema,
  type WireSchemaAny,
} from "./define";
import { RPC_STREAM_CHUNK_BYTES } from "./frameChunking";

/** The byte sizes the framer needs, all measured by the CALLER (which owns the
 *  key/value schemas) so the arithmetic here never guesses at an encoding it
 *  cannot see. A trimmed estimate would be the exact bug the budget exists to
 *  prevent. */
export interface DeltasSizes<K, T> {
  /** Encoded bytes of the WHOLE frame as it would hit the wire — the fast-path
   *  test, and (with the part scaffolding subtracted) the envelope the packing
   *  arithmetic allows for. */
  readonly frame: (msg: CollectionDeltasMsg<K, T>) => number;
  /** Encoded bytes of one `[key, value]` entry (no envelope). */
  readonly entry: (pair: readonly [K, T]) => number;
  /** Encoded bytes of one removed key (no envelope). */
  readonly key: (key: K) => number;
}

/** What the framing adds around a part beyond its items: `{"kind":"…",…,"part":
 *  {"seq":N,"of":M}}`. Generous by an order of magnitude — the two-digit indices
 *  and the scaffolding are tens of bytes — and subtracted from the budget so a
 *  part's ITEMS are packed to fit after it. */
const DELTA_PART_ENVELOPE_BYTES = 256;

/** The byte sizes a collection's schemas imply, measured with the ONE encoder
 *  the wire itself uses (`Schema.encodeUnknownSync`) rather than a `JSON.stringify`
 *  guess: a schema with an ENCODE transform (a `Date` to an ISO string) would
 *  otherwise be measured as something other than what crosses, and a budget built
 *  on the wrong number is the bug it exists to prevent. `JSON.stringify` of the
 *  ENCODED value IS the ndjson text length for the ASCII JSON that reaches these
 *  sizes. */
export function deltasSizes<K, T>(
  keySchema: WireSchemaAny,
  schema: WireSchemaAny,
): DeltasSizes<K, T> {
  const frameJson = Schema.encodeUnknownSync(
    collectionDeltasSchema(keySchema, schema),
  );
  const entryJson = Schema.encodeUnknownSync(Schema.Tuple([keySchema, schema]));
  const keyJson = Schema.encodeUnknownSync(keySchema);
  // BYTES, not UTF-16 code units. `String.length` counts code units, so a CJK or
  // emoji value is up to 3× larger on the wire than it measures — which would turn
  // a 2 s drain into 6 s and slip past the ping interval the budget is sized
  // against. `Buffer.byteLength` on the server leg this runs on; `TextEncoder` as
  // the isomorphic fallback (the module is shared with the browser bundle).
  const bytes = (encoded: unknown): number => {
    const text = JSON.stringify(encoded);
    return typeof Buffer !== "undefined"
      ? Buffer.byteLength(text)
      : new TextEncoder().encode(text).length;
  };
  // Measure each frame ONCE, however many subscribers read it. A collection's
  // `deltasBus` fans ONE value object out to every subscriber (`inMemoryChannel`),
  // and every subscriber's handler runs the fast-path test on that same object —
  // so a WeakMap keyed by the frame makes the per-subscriber encode a one-time
  // cost per frame instead of one per tab per tick. The snapshot is a fresh
  // object per subscribe (its encode is inherent to producing the response); the
  // DELTA frames are the hot path this saves.
  const measured = new WeakMap<object, number>();
  return {
    frame: (msg) => {
      const hit = measured.get(msg);
      if (hit !== undefined) return hit;
      const size = bytes(frameJson(msg));
      measured.set(msg, size);
      return size;
    },
    entry: (pair) => bytes(entryJson(pair)),
    key: (key) => bytes(keyJson(key)),
  };
}

/** Contiguous index runs of `sizes`, each whose sum is ≤ `capacity` — the ONE
 *  statement of the packing arithmetic, shared by both frame arms. A single item
 *  larger than `capacity` gets a run of its own: the item is the unit this layer
 *  knows, so it cannot be split further. */
function packRuns(
  sizes: readonly number[],
  capacity: number,
): Array<[from: number, to: number]> {
  const runs: Array<[number, number]> = [];
  let start = 0;
  let used = 0;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i]!;
    if (i > start && used + size > capacity) {
      runs.push([start, i]);
      start = i;
      used = 0;
    }
    used += size;
  }
  if (start < sizes.length) runs.push([start, sizes.length]);
  return runs;
}

/** Split a frame into wire-legal parts, each whose ITEMS fit
 *  `budget - DELTA_PART_ENVELOPE_BYTES` and none larger than `budget`.
 *
 *  A frame within budget is returned UNCHANGED, as a one-element array — the
 *  common case, and the one that keeps a small collection's bytes frozen. A
 *  single ITEM larger than the budget is emitted whole in a one-item part: still
 *  under the 16 MiB decoder cap by construction of the collection schemas, just
 *  past the soft drain budget — the honest answer, not a silent truncation. */
export function splitCollectionDeltas<K, T>(
  msg: CollectionDeltasMsg<K, T>,
  sizes: DeltasSizes<K, T>,
  budget: number = RPC_STREAM_CHUNK_BYTES,
): readonly CollectionDeltasMsg<K, T>[] {
  if (sizes.frame(msg) <= budget) return [msg];
  const capacity = budget - DELTA_PART_ENVELOPE_BYTES;

  if (msg.kind === "snapshot") {
    const parts = packRuns(msg.entries.map(sizes.entry), capacity).map(
      ([from, to]): CollectionDeltasMsg<K, T> => ({
        kind: "snapshot",
        entries: msg.entries.slice(from, to),
      }),
    );
    return withPartMarkers(parts);
  }

  // A delta carries two ordered lists (upserts, then removes) packed as ONE run,
  // so a part boundary may fall between them; each part is rebuilt by slicing
  // each list at the run, and the reassembler concatenates them back in `seq`
  // order — the split point is invisible.
  const upsertCount = msg.upserts.length;
  const itemSizes = [
    ...msg.upserts.map(sizes.entry),
    ...msg.removes.map(sizes.key),
  ];
  const parts = packRuns(itemSizes, capacity).map(
    ([from, to]): CollectionDeltasMsg<K, T> => ({
      kind: "delta",
      upserts: msg.upserts.slice(from, Math.min(to, upsertCount)),
      removes: msg.removes.slice(
        Math.max(0, from - upsertCount),
        Math.max(0, to - upsertCount),
      ),
    }),
  );
  return withPartMarkers(parts);
}

/** Stamp `part: {seq, of}` onto a just-split run. A single part is returned
 *  WITHOUT the marker — a frame that was not actually divided keeps today's
 *  bytes, so the only frames carrying `part` are the ones a reader must join. */
function withPartMarkers<K, T>(
  parts: CollectionDeltasMsg<K, T>[],
): readonly CollectionDeltasMsg<K, T>[] {
  if (parts.length <= 1) return parts;
  return parts.map((frame, seq) => ({
    ...frame,
    part: { seq, of: parts.length },
  }));
}

/**
 * Fold a `deltas` stream's parts back into whole frames. The ONE reassembler —
 * every consumer reads through it (the client face applies it at the member, so
 * `useCollection`, `mirrorRemoteSurface` and a `SurfaceMap` fold are all
 * transparent automatically).
 *
 * State is a single in-progress buffer: `seq: 0` starts (or restarts) it, each
 * later `seq` appends, and the final part (`seq === of - 1`) emits. A frame with
 * no `part` passes straight through and CLEARS the buffer (a whole frame is the
 * end of whatever came before it — a stale partial must not splice onto it). */
export function reassembleCollectionDeltas<K, T>(
  frames: Stream.Stream<CollectionDeltasMsg<K, T>, unknown>,
): Stream.Stream<CollectionDeltasMsg<K, T>, unknown> {
  /** A frame being joined, its own arm — the accumulating state. */
  type Open =
    | { kind: "snapshot"; of: number; seq: number; entries: [K, T][] }
    | {
        kind: "delta";
        of: number;
        seq: number;
        upserts: [K, T][];
        removes: K[];
      };

  const begin = (of: number, kind: Open["kind"]): Open =>
    kind === "snapshot"
      ? { kind, of, seq: 0, entries: [] }
      : { kind, of, seq: 0, upserts: [], removes: [] };

  /** Append one part's items. The caller has already matched the arms. */
  const extend = (open: Open, msg: CollectionDeltasMsg<K, T>): void => {
    if (open.kind === "snapshot" && msg.kind === "snapshot") {
      open.entries.push(...msg.entries);
    } else if (open.kind === "delta" && msg.kind === "delta") {
      open.upserts.push(...msg.upserts);
      open.removes.push(...msg.removes);
    }
  };

  /** The joined frame, its part marker dropped — what a consumer sees. */
  const whole = (open: Open): CollectionDeltasMsg<K, T> =>
    open.kind === "snapshot"
      ? { kind: "snapshot", entries: open.entries }
      : { kind: "delta", upserts: open.upserts, removes: open.removes };

  return Stream.mapAccumArray<
    Open | undefined,
    CollectionDeltasMsg<K, T>,
    CollectionDeltasMsg<K, T>
  >(
    () => undefined,
    (open, chunk) => {
      const out: CollectionDeltasMsg<K, T>[] = [];
      for (const msg of chunk) {
        const part = msg.part;
        if (part === undefined) {
          // A whole frame ends whatever partial preceded it — a stale buffer
          // must not splice onto it.
          open = undefined;
          out.push(msg);
          continue;
        }
        // `seq: 0` (or a different arm) starts a fresh buffer; a part that lands
        // on the wrong one is a bug (a lost part, two frames spliced), refused
        // rather than spliced in an invented order — parts are contiguous and
        // ordered on the wire (the server is ack-gated and sequential).
        if (part.seq === 0 || open === undefined || open.kind !== msg.kind) {
          open = begin(part.of, msg.kind);
        }
        if (part.seq !== open.seq) throw misorderedPart(part.seq, open.seq);
        extend(open, msg);
        open.seq += 1;
        if (open.seq === open.of) {
          out.push(whole(open));
          open = undefined;
        }
      }
      return [open, out];
    },
  )(frames);
}

function misorderedPart(got: number, want: number): Error {
  return new Error(
    `collection deltas reassembly: expected part ${want} but received ${got} — ` +
      "parts of one frame are contiguous on the wire; a gap means a frame was " +
      "lost or two frames were spliced. Refusing to guess an order.",
  );
}
