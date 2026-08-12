/**
 * The chunking arithmetic, measured rather than asserted in prose.
 *
 * `frameChunking.ts`'s header makes three claims a comment cannot keep true: that
 * a full chunk's frame clears the cap with margin, that concatenating the pieces
 * reproduces the bytes exactly, and that every boundary lands where base64 can
 * be cut. Each is a property over many inputs here, not one worked example — the
 * failures this module exists to prevent (a bumped chunk size, a fatter
 * envelope, a boundary off by one group) all hide between the examples someone
 * would have picked.
 */

import { describe, expect, it } from "vitest";
import {
  base64CharsFor,
  base64DecodedLength,
  chunkBase64,
  FRAME_CHUNK_BASE64_CHARS,
  FRAME_CHUNK_BYTES,
  FRAME_ENVELOPE_BYTES,
  FRAME_PAYLOAD_BUDGET,
} from "./frameChunking.ts";
import { exceedsFrameLimit, RPC_MAX_FRAME_BYTES } from "./frameLimit.ts";

/** Deterministic pseudo-random bytes — a fixed LCG rather than `Math.random`,
 *  so a failure is reproducible and the properties below are re-runnable. */
function bytes(count: number, seed: number): Uint8Array {
  const out = new Uint8Array(count);
  let state = seed >>> 0;
  for (let i = 0; i < count; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

const toBase64 = (raw: Uint8Array) => Buffer.from(raw).toString("base64");

/** Every raw length worth probing around a chunk boundary: empty, sub-chunk,
 *  exactly one chunk, one group over, several chunks, and a ragged tail. Stated
 *  in CHARS-of-base64 terms via a small stand-in chunk size, so the properties
 *  run over real byte arrays instead of 3 MiB ones. */
const SMALL_CHUNK_CHARS = 8; // 8 base64 chars = 6 raw bytes
const RAW_LENGTHS = [0, 1, 2, 3, 5, 6, 7, 11, 12, 13, 17, 18, 19, 60, 61, 255];

describe("the pieces reassemble into exactly the bytes that went in", () => {
  it.each(
    RAW_LENGTHS,
  )("%i raw bytes: concatenated chunks decode byte-identical", (length) => {
    const raw = bytes(length, length + 1);
    const encoded = toBase64(raw);
    const pieces = chunkBase64(encoded, SMALL_CHUNK_CHARS);

    // The concatenation is the same STRING — nothing was dropped or doubled.
    expect(pieces.join("")).toBe(encoded);

    // And each piece decodes ALONE, which is the property that matters: the
    // server appends `Buffer.from(piece, "base64")` per call and never sees
    // the whole string. Splitting off a 4-character group would still
    // reassemble as a string while decoding to garbage.
    const decoded = Buffer.concat(
      pieces.map((piece) => Buffer.from(piece, "base64")),
    );
    expect(new Uint8Array(decoded)).toEqual(raw);
  });

  it("emits at least one piece for empty input — an empty file still lands", () => {
    // The caller's loop is "first chunk creates, later ones append". Zero pieces
    // would mean zero writes and no file at all.
    expect(chunkBase64("", SMALL_CHUNK_CHARS)).toEqual([""]);
    expect(chunkBase64("").length).toBeGreaterThan(0);
  });
});

describe("every boundary lands on a 4-character group", () => {
  it.each(
    RAW_LENGTHS,
  )("%i raw bytes: only the LAST piece may be short or padded", (length) => {
    const pieces = chunkBase64(
      toBase64(bytes(length, length + 7)),
      SMALL_CHUNK_CHARS,
    );
    for (const piece of pieces.slice(0, -1)) {
      expect(piece.length).toBe(SMALL_CHUNK_CHARS);
      expect(piece).not.toMatch(/=/); // padding may only close the stream
    }
    const last = pieces[pieces.length - 1] ?? "";
    expect(last.length % 4).toBe(0);
    expect(last.length).toBeLessThanOrEqual(SMALL_CHUNK_CHARS);
  });

  it("refuses a chunk size that is not a multiple of 4", () => {
    // Fail loudly at the call rather than shipping pieces that decode to
    // garbage — the corruption is silent, so the guard cannot be.
    expect(() => chunkBase64("AAAAAAAA", 6)).toThrow(/multiple of 4/);
  });
});

describe("no emitted frame can bust the cap", () => {
  it.each(
    RAW_LENGTHS.map((n) => n * 1000),
  )("%i raw bytes: every chunk's frame clears the limit after the envelope", (length) => {
    const pieces = chunkBase64(toBase64(bytes(length, 42)));
    for (const piece of pieces) {
      expect(piece.length).toBeLessThanOrEqual(FRAME_CHUNK_BASE64_CHARS);
      expect(exceedsFrameLimit(piece.length + FRAME_ENVELOPE_BYTES)).toBe(
        false,
      );
    }
  });

  it("holds at the real chunk size too — a 26 MB drop, the incident's size", () => {
    // The production failure was one 26 MB frame. Content is irrelevant here;
    // only the LENGTH drives the chunking, so a cheap repeat stands in for the
    // file. Nine bounded frames instead of one lethal one.
    const encoded = "A".repeat(base64CharsFor(26 * 1024 * 1024));
    const pieces = chunkBase64(encoded);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe(encoded);
    for (const piece of pieces) {
      expect(piece.length % 4).toBe(0);
      expect(exceedsFrameLimit(piece.length + FRAME_ENVELOPE_BYTES)).toBe(
        false,
      );
    }
  });

  it("a FULL chunk still clears the cap with the documented margin", () => {
    // The header's table, as arithmetic. Raise FRAME_CHUNK_BYTES past its margin
    // and this fails here rather than as a closed socket in production.
    const frame = FRAME_CHUNK_BASE64_CHARS + FRAME_ENVELOPE_BYTES;
    expect(FRAME_CHUNK_BASE64_CHARS).toBeLessThanOrEqual(FRAME_PAYLOAD_BUDGET);
    expect(exceedsFrameLimit(frame)).toBe(false);
    expect(RPC_MAX_FRAME_BYTES / frame).toBeGreaterThan(3.9);
  });
});

describe("the two expansions, and only those two", () => {
  it("expands base64 by exactly 4/3 for every real byte count", () => {
    for (const length of RAW_LENGTHS) {
      const encoded = toBase64(bytes(length, length + 13));
      expect(encoded.length).toBe(base64CharsFor(length));
      expect(base64DecodedLength(encoded)).toBe(length);
    }
  });

  it("keeps the chunk a multiple of 3, so its base64 is a multiple of 4", () => {
    // This is what lets a chunk boundary BE a group boundary. A round 4 MiB
    // would not divide by 3; 3 MiB does, exactly.
    expect(FRAME_CHUNK_BYTES % 3).toBe(0);
    expect(FRAME_CHUNK_BASE64_CHARS).toBe((FRAME_CHUNK_BYTES / 3) * 4);
    expect(FRAME_CHUNK_BASE64_CHARS % 4).toBe(0);
  });

  it("has no THIRD expansion — base64 needs no JSON escaping", () => {
    // The term it is tempting to add. If any base64 character had to be escaped
    // inside a JSON string, the envelope budget would have to absorb a
    // per-character cost and the whole derivation would move.
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    expect(JSON.stringify(alphabet)).toBe(`"${alphabet}"`);

    // Stated the way a frame actually measures it: the encoded envelope-plus-
    // payload is the payload's own length plus the JSON around it, with no
    // per-character surcharge.
    const payload = toBase64(bytes(3000, 5));
    const frame = JSON.stringify({ data: payload });
    expect(frame.length - payload.length).toBeLessThan(FRAME_ENVELOPE_BYTES);
  });

  it("budgets an envelope that is generous against a real one", () => {
    // 64 KiB against a worst-case-ish request: long procedure path, a uuid, and
    // two PATH_MAX-length strings.
    const worstCase = JSON.stringify({
      _tag: "Request",
      id: "0".repeat(64),
      tag: "padi.scratch.write",
      payload: {
        terminalId: "0".repeat(64),
        name: "n".repeat(4096),
        appendTo: `/${"d".repeat(4095)}`,
        data: "",
      },
    }).length;
    expect(worstCase).toBeLessThan(FRAME_ENVELOPE_BYTES);
  });
});
