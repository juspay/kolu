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

/** Is this frame one part of a larger one? */
export function isCollectionDeltaPart(
  msg: CollectionDeltasMsg<unknown, unknown>,
): boolean {
  return msg.part !== undefined;
}

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
export const DELTA_PART_ENVELOPE_BYTES = 256;

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
  const bytes = (encoded: unknown): number => JSON.stringify(encoded).length;
  return {
    frame: (msg) => bytes(frameJson(msg)),
    entry: (pair) => bytes(entryJson(pair)),
    key: (key) => bytes(keyJson(key)),
  };
}

/** Split a frame into wire-legal parts, each whose ITEMS fit
 *  `budget - DELTA_PART_ENVELOPE_BYTES` and none larger than `budget`.
 *
 *  A frame within budget is returned UNCHANGED, as a one-element array — the
 *  common case, and the one that keeps a small collection's bytes frozen. A
 *  single ITEM larger than the budget cannot be split here (the item IS the unit
 *  this layer knows), so it is emitted whole in a one-item part: still under the
 *  16 MiB decoder cap by construction of the collection schemas, just past the
 *  soft drain budget — the honest answer, not a silent truncation. */
export function splitCollectionDeltas<K, T>(
  msg: CollectionDeltasMsg<K, T>,
  sizes: DeltasSizes<K, T>,
  budget: number = RPC_STREAM_CHUNK_BYTES,
): readonly CollectionDeltasMsg<K, T>[] {
  if (sizes.frame(msg) <= budget) return [msg];
  const capacity = budget - DELTA_PART_ENVELOPE_BYTES;

  if (msg.kind === "snapshot") {
    const parts: CollectionDeltasMsg<K, T>[] = [];
    let batch: [K, T][] = [];
    let used = 0;
    const flush = (): void => {
      if (batch.length === 0) return;
      parts.push({ kind: "snapshot", entries: batch });
      batch = [];
      used = 0;
    };
    for (const pair of msg.entries) {
      const size = sizes.entry(pair);
      if (batch.length > 0 && used + size > capacity) flush();
      batch.push(pair);
      used += size;
    }
    flush();
    return withPartMarkers(parts);
  }

  // A delta carries two ordered lists (upserts, then removes). Pack them in
  // order into one run of parts; the reassembler concatenates each list back in
  // `seq` order, so the split point between the lists is invisible.
  const parts: CollectionDeltasMsg<K, T>[] = [];
  let upserts: [K, T][] = [];
  let removes: K[] = [];
  let used = 0;
  const flush = (): void => {
    if (upserts.length === 0 && removes.length === 0) return;
    parts.push({ kind: "delta", upserts, removes });
    upserts = [];
    removes = [];
    used = 0;
  };
  for (const pair of msg.upserts) {
    const size = sizes.entry(pair);
    if ((upserts.length > 0 || removes.length > 0) && used + size > capacity)
      flush();
    upserts.push(pair);
    used += size;
  }
  for (const key of msg.removes) {
    const size = sizes.key(key);
    if ((upserts.length > 0 || removes.length > 0) && used + size > capacity)
      flush();
    removes.push(key);
    used += size;
  }
  flush();
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
  type Open = {
    kind: "snapshot" | "delta";
    of: number;
    seq: number;
    entries: [K, T][];
    upserts: [K, T][];
    removes: K[];
  };

  const blank = (kind: Open["kind"], of: number): Open => ({
    kind,
    of,
    seq: 0,
    entries: [],
    upserts: [],
    removes: [],
  });

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
        if (msg.kind === "snapshot") {
          if (
            part.seq === 0 ||
            open === undefined ||
            open.kind !== "snapshot"
          ) {
            open = blank("snapshot", part.of);
          }
          // Parts of one frame are contiguous and ordered on the wire (the
          // server is ack-gated and sequential); a duplicate or a gap is a bug
          // worth surfacing rather than splicing in an invented order.
          if (part.seq !== open.seq) throw misorderedPart(part.seq, open.seq);
          open.entries.push(...msg.entries);
          open.seq += 1;
          if (open.seq === open.of) {
            out.push({ kind: "snapshot", entries: open.entries });
            open = undefined;
          }
          continue;
        }
        if (part.seq === 0 || open === undefined || open.kind !== "delta") {
          open = blank("delta", part.of);
        }
        if (part.seq !== open.seq) throw misorderedPart(part.seq, open.seq);
        open.upserts.push(...msg.upserts);
        open.removes.push(...msg.removes);
        open.seq += 1;
        if (open.seq === open.of) {
          out.push({
            kind: "delta",
            upserts: open.upserts,
            removes: open.removes,
          });
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
