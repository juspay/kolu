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
 * is what a sender does about it: give it an encoded payload and the budget
 * derived from the cap, get legal frames. Encoding stays the caller's —
 * {@link chunkBase64} splits a base64 STRING, and {@link base64CharsFor} sizes
 * one before it is built.
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
 * `rejectionFor` / `MAX_UPLOAD_BYTES` in `@kolu/padi-client/upload`; olai's
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

/** Raw bytes one OUTBOUND STREAM frame may carry of user content — the budget a
 *  multi-entry collection snapshot (or any stream frame that scales with user
 *  content) is split into before it reaches the wire.
 *
 *  ## Why the cap is NOT the budget (the drain arithmetic)
 *
 *  {@link RPC_MAX_FRAME_BYTES} answers "will the decoder reject this frame?"; it
 *  is the 16 MiB backstop, far too large to answer "will this frame still be
 *  draining when the link's liveness check needs an answer?". A frame counts
 *  as arriving only once it has fully arrived, and everything behind it on the
 *  socket — another stream's frame, the watchdog's probe answer, a pong —
 *  waits for it. A frame that is legal by the size cap can therefore still be
 *  FATAL by time.
 *
 *  The deadline that bites first is the framework watchdog's: its probe
 *  (`system.live`) must be answered within `DEFAULT_HEARTBEAT_TIMEOUT_MS`
 *  (10s), and on the ssh leg that watchdog is not progress-aware, so an answer
 *  stuck behind a big frame reads as a dead host. (The link's own keep-alive
 *  sits far above it — no decoded frame for 60s, `./keepAlive.ts` — and the
 *  browser leg's watchdog voids a late probe once any frame has arrived.)
 *
 *  A subscription's frames are ACK-GATED (`RpcServer.streamEffect` waits for the
 *  client's ack before the next Chunk), so at most ONE chunk is ever in flight:
 *  the transport buffer never holds a backlog of this stream, and the probe's
 *  answer queues behind that one chunk and no more. The bound that matters is
 *  therefore "time to drain ONE chunk", and it must sit comfortably inside the
 *  probe timeout:
 *
 *     budget  = floor_bandwidth × (DEFAULT_HEARTBEAT_TIMEOUT_MS / safety)
 *
 *  Take a cellular tether measured at ~1 Mbit/s ≈ 128 KiB/s as the floor worth
 *  serving (below it a multi-MB snapshot is bandwidth-bound no matter how it is
 *  framed), and a safety factor of 4 against the probe timeout:
 *
 *     drain:  262144 / 131072 = 2.00s      (at the 1 Mbit/s floor)
 *     + RTT:  ~0.5s on the same link       (the ack that gates the next chunk)
 *     total:  ~2.5s ≤ 10s / 4  (the probe timeout, 4x headroom)
 *                   < 60s      (RPC_PING_TIMEOUT_MS, 24x headroom)
 *
 *  `frameChunking.test.ts` pins that arithmetic against the imported numbers.
 *  256 KiB is also a round power of two (a clean slice of the log line, and far
 *  enough under the 16 MiB cap — 1.5% — that the chunk never trips the decoder).
 *  A 5 MB transcript then costs ~20 chunks; the ack round trips add ~10s of dead
 *  time at a 200ms RTT, against ~39s of pure transmission at 1 Mbit/s — an
 *  acceptable tax for a link that stays alive.
 *
 *  BAKED, not a knob: a tunable would be a way to reintroduce the starvation.
 *
 *  ## The bound is per STREAM — and the socket is shared
 *
 *  Ack-gating bounds ONE stream to a single part in flight, but a reconnect
 *  re-subscribes every collection on the socket at once, so up to K parts can sit
 *  on the wire together (K = the collections whose snapshot exceeds this budget),
 *  and the probe's answer queues behind all K rather than one. Stated honestly,
 *  per leg:
 *
 *   - the link's keep-alive is never at risk: it counts EVERY decoded frame, and
 *     the K parts land one at a time, each within one chunk's drain;
 *   - the browser watchdog is not at risk either: a part landing after its probe
 *     launched voids the timeout;
 *   - the ssh-leg watchdog is: its probe answer waits K × ~2s at the 1 Mbit/s
 *     floor, so K ≥ 5 large snapshots resuming together can read as a dead host
 *     (the test pins K = 4 as the most that fits). K is small in practice — a
 *     snapshot is a single frame unless it exceeds the budget, and the incident
 *     this exists for is one such collection. A connection-level part gate (one
 *     part in flight per socket) is the follow-up that would close it. */
export const RPC_STREAM_CHUNK_BYTES = 256 * 1024;

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
  // POSITIVE and a multiple of 4, in one guard because zero satisfies the
  // second on its own: `0 % 4` is 0, and a zero stride advances the loop below
  // by nothing — it spins until the process dies. A negative stride walks
  // backwards to the same end. Neither is a size anyone means, so neither may
  // reach the loop.
  if (chunkChars <= 0 || chunkChars % 4 !== 0) {
    throw new Error(
      `a base64 chunk must be a positive multiple of 4 characters, got ${chunkChars}`,
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
