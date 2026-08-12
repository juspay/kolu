/**
 * Fitting a payload UNDER the frame cap — the sender's half of `./frameLimit.ts`.
 *
 * ## Why this lives here
 *
 * An oversized frame is not a failed call. Effect RPC's ndjson decoder answers
 * one with `Socket.CloseEvent(1009)` — it kills the whole connection — and every
 * surface multiplexes onto ONE socket per tab, so a single fat frame takes every
 * unrelated subscription down with it. The full argument, the beta marker, and
 * the incident that proved it live next door in `./frameLimit.ts`. This module
 * is what a sender does about it: give it bytes and the budget derived from the
 * cap, get legal frames.
 *
 * The arithmetic below has now been derived from scratch TWICE in kolu's orbit —
 * once in `@kolu/padi`'s `upload.ts` (where the incident happened), then copied
 * into olai's `packages/surface/src/attach.ts` under the header "because it was
 * derived the hard way there and re-deriving it is how the same incident happens
 * twice." Every surface-app that ever uploads a byte needs it, and the third
 * derivation is the one that gets a term wrong. So it is paid in once, beside
 * the cap it guards against, and imported rather than restated — the #71 lesson
 * (a second copy of `maxPayload` disagreed with the classifier above it and
 * killed the frames in between).
 *
 * What does NOT belong here: what a given app will *accept*. A file-size policy
 * cap, an extension allowlist, a rejection sentence, where the bytes land on
 * disk — those are the house's gate, and they stay in the house (kolu's
 * `rejectionFor` / `MAX_UPLOAD_BYTES` in `@kolu/padi/upload`; olai's
 * `attachmentRejection`). This module pays the arithmetic, not the gate.
 *
 * ## The derivation
 *
 * A chunk must fit inside {@link RPC_MAX_FRAME_BYTES} after two expansions, and
 * exactly two:
 *
 * 1. **base64** — the wire field is a string, so R raw bytes become
 *    `ceil(R / 3) * 4` characters: 4/3, about 1.334x.
 * 2. **the JSON envelope** — the frame is the whole encoded request, not just
 *    the payload: procedure path, request id, whatever ids the member carries,
 *    a destination path, a filename, and JSON's own quoting. Bounded by the low
 *    kilobytes, since paths and filenames are both PATH_MAX-ish; 64 KiB is a
 *    generous ceiling ({@link FRAME_ENVELOPE_BYTES}).
 *
 * There is no THIRD expansion: base64's alphabet (`A-Za-z0-9+/=`) contains no
 * character JSON escapes, so the payload does not grow again inside the JSON
 * string. That is the term it is tempting to add, and it is genuinely absent.
 *
 * The chunk size must also be a MULTIPLE OF 3, so base64's 3-bytes-to-4-characters
 * grouping divides it exactly and every chunk boundary lands on a 4-character
 * group — which is what lets each piece decode independently of its neighbours
 * (see {@link chunkBase64}). A MiB is 1048576, which is NOT divisible by 3, so a
 * round 4 MiB fails that requirement. 3 MiB is the nearest size that satisfies
 * it, and it lands on a pleasant identity: 3 MiB of bytes is exactly 4 MiB of
 * base64.
 *
 *     base64:   (3145728 / 3) * 4 = 4194304 bytes  (4.00 MiB, exact)
 *     envelope: < 65536 bytes
 *     frame:    < 4259840 bytes                    (4.06 MiB)
 *     budget:   16777216 bytes                     (16.00 MiB)
 *     headroom: ~3.9x
 *
 * The chunk is deliberately far under the budget rather than filling it. Nearly
 * 4x margin means the number survives a bump that adds envelope fields, and a
 * re-derivation that discovers another modest expansion — while a 50 MB file
 * still costs only 17 round trips. Trading a handful of round trips for a 4x
 * margin on a socket-killing failure is the right side of that trade.
 *
 * That last comparison is a TEST rather than a claim — see `./frameChunking.test.ts`,
 * which measures the chunk against the imported budget. A framework bump that
 * moved the cap would otherwise rot a paragraph nobody re-reads.
 */

import { RPC_MAX_FRAME_BYTES } from "./frameLimit.ts";

/** What everything on the frame OTHER than the base64 payload is budgeted at:
 *  the procedure path, the request id, the member's own ids, a destination
 *  path, a filename, and JSON's quoting. Generous by an order of magnitude, and
 *  exported so the headroom is something a test can measure rather than a
 *  sentence in a comment. */
export const FRAME_ENVELOPE_BYTES = 64 * 1024;

/** How much of a frame one chunk's payload may occupy — the budget the framing
 *  layer owns, minus what everything else on the frame is allowed to cost. */
export const FRAME_PAYLOAD_BUDGET = RPC_MAX_FRAME_BYTES - FRAME_ENVELOPE_BYTES;

/** How many base64 characters `rawBytes` encodes to — `ceil(R / 3) * 4`, the
 *  4/3 expansion stated once so no caller re-derives it. */
export function base64CharsFor(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/** Raw bytes of content carried by ONE frame. A multiple of 3, so the base64
 *  division is exact — see the derivation in this module's header. */
export const FRAME_CHUNK_BYTES = 3 * 1024 * 1024;

/** Base64 characters per chunk — {@link FRAME_CHUNK_BYTES} after the 4/3
 *  expansion.
 *
 *  A multiple of 4 BY CONSTRUCTION, which is what makes chunking a base64
 *  STRING sound: every 4-character group decodes to exactly 3 bytes
 *  independently of its neighbours, so splitting on a 4-character boundary and
 *  decoding each piece separately concatenates to the same bytes as decoding the
 *  whole. Split off that boundary and the pieces decode to garbage. The unit
 *  test re-checks the multiple rather than assuming it. */
export const FRAME_CHUNK_BASE64_CHARS = base64CharsFor(FRAME_CHUNK_BYTES);

/** How many bytes a base64 string decodes to, without decoding it — a size gate
 *  reads this rather than materialising a buffer to measure. */
export function base64DecodedLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/** What a frame carrying `base64Chars` of payload costs on the wire, envelope
 *  included — the number to hand `exceedsFrameLimit` (`./frameLimit.ts`) for a
 *  pre-send refusal. Callers own the refusal's wording; they must not own its
 *  arithmetic, which is how the two ends of a margin drift apart. */
export function frameBytesFor(base64Chars: number): number {
  return base64Chars + FRAME_ENVELOPE_BYTES;
}

/**
 * Split a base64 string into wire-sized pieces on 4-character boundaries.
 *
 * The type says AT LEAST ONE piece, and that is load-bearing rather than
 * decorative: the caller's loop is "the first chunk creates the file, every
 * later one appends", so an empty input still has to perform exactly one write
 * — otherwise an empty file never lands on disk, and a caller that had to
 * consider an empty list would be writing a branch for a file that was never
 * created.
 *
 * `chunkChars` is a parameter only so a test can drive the boundary arithmetic
 * with numbers it can read, and so a pre-send refusal is reachable; production
 * passes nothing.
 */
export function chunkBase64(
  data: string,
  chunkChars: number = FRAME_CHUNK_BASE64_CHARS,
): readonly [string, ...ReadonlyArray<string>] {
  if (chunkChars % 4 !== 0) {
    throw new Error(
      `a base64 chunk must be a multiple of 4 characters, got ${chunkChars}`,
    );
  }
  // The one case the loop below cannot state: an empty input is still one write.
  if (data === "") return [""];
  const pieces: [string, ...Array<string>] = [data.slice(0, chunkChars)];
  for (let at = chunkChars; at < data.length; at += chunkChars) {
    pieces.push(data.slice(at, at + chunkChars));
  }
  return pieces;
}
