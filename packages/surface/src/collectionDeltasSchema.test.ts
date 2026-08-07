/**
 * `collectionDeltasSchema` — the FROZEN wire format of a collection's batched
 * `deltas` stream.
 *
 * Two authorities decode this shape (`@kolu/surface`'s own `deltas` verb and
 * `@kolu/surface-map`'s folded entry collection), and a re-serving parent relays
 * frames between them untouched. So the format is not an implementation detail
 * of either: it is a contract, and this file is its byte-level fixture.
 *
 * The fixtures below are the EXACT JSON the zod/oRPC original put on the wire,
 * captured before the Effect Schema port and asserted here as literal strings —
 * decode-equality alone would not catch a re-ordered key, an entry tuple that
 * became an object, or a discriminant renamed from `kind` to `_tag`, all of
 * which round-trip fine within one implementation while breaking every peer.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { type CollectionDeltasMsg, collectionDeltasSchema } from "./define";

const keySchema = Schema.Number;
const valueSchema = Schema.Struct({ label: Schema.String, n: Schema.Number });
const deltas = collectionDeltasSchema(keySchema, valueSchema);

const encode = Schema.encodeUnknownSync(deltas);
const decode = Schema.decodeUnknownSync(deltas);

type Msg = CollectionDeltasMsg<number, { label: string; n: number }>;

const SNAPSHOT: Msg = {
  kind: "snapshot",
  entries: [
    [1, { label: "a", n: 1 }],
    [2, { label: "b", n: 2 }],
  ],
};
const SNAPSHOT_JSON =
  '{"kind":"snapshot","entries":[[1,{"label":"a","n":1}],[2,{"label":"b","n":2}]]}';

const DELTA: Msg = {
  kind: "delta",
  upserts: [[3, { label: "c", n: 3 }]],
  removes: [1, 2],
};
const DELTA_JSON =
  '{"kind":"delta","upserts":[[3,{"label":"c","n":3}]],"removes":[1,2]}';

describe("collectionDeltasSchema wire format", () => {
  it("encodes a snapshot frame to the exact frozen bytes", () => {
    expect(JSON.stringify(encode(SNAPSHOT))).toBe(SNAPSHOT_JSON);
  });

  it("encodes a delta frame to the exact frozen bytes", () => {
    expect(JSON.stringify(encode(DELTA))).toBe(DELTA_JSON);
  });

  it("decodes the frozen bytes back to the frame a peer produced", () => {
    expect(decode(JSON.parse(SNAPSHOT_JSON))).toEqual(SNAPSHOT);
    expect(decode(JSON.parse(DELTA_JSON))).toEqual(DELTA);
  });

  it("survives the relay hop — decode → re-encode is byte-identical", () => {
    // A re-serving parent decodes a frame from its upstream and re-encodes it
    // downstream. Any asymmetry between the two directions would corrupt the
    // frame at the middle hop and only show up three processes away.
    for (const json of [SNAPSHOT_JSON, DELTA_JSON]) {
      expect(JSON.stringify(encode(decode(JSON.parse(json))))).toBe(json);
    }
  });

  it("an empty snapshot is an empty entries array, not a missing key", () => {
    expect(JSON.stringify(encode({ kind: "snapshot", entries: [] }))).toBe(
      '{"kind":"snapshot","entries":[]}',
    );
  });

  it("rejects a frame with an unknown discriminant", () => {
    expect(() => decode({ kind: "patch", entries: [] })).toThrow();
  });

  it("rejects an entry that is not a [key, value] pair", () => {
    expect(() =>
      decode({
        kind: "snapshot",
        entries: [{ key: 1, value: { label: "a", n: 1 } }],
      }),
    ).toThrow();
  });

  it("carries the key schema's own type, not a stringified key", () => {
    // Number keys stay numbers on the wire: the per-key channel names stringify
    // keys, but the deltas frame does not, and a consumer folding it rebuilds a
    // map keyed by the real key type.
    const decoded = decode(JSON.parse(SNAPSHOT_JSON));
    expect(decoded.kind).toBe("snapshot");
    if (decoded.kind !== "snapshot") throw new Error("unreachable");
    expect(decoded.entries.map(([k]) => k)).toEqual([1, 2]);
  });
});
