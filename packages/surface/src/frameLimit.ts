/**
 * The RPC wire's FRAME SIZE limit — one constant, owned here, applied at every
 * ndjson serialization site on both legs of every link.
 *
 * ## Why this file exists
 *
 * Effect RPC's ndjson decoder buffers bytes until it sees a newline, and caps
 * that buffer. Exceed the cap and the decode does not fail the one oversized
 * CALL — on the server leg it answers with `Socket.CloseEvent(1009)`, i.e. it
 * kills the whole connection (`RpcServer.js`, the `MaxBufferSizeExceeded`
 * branch of the inbound decode). Every surface multiplexes onto ONE socket per
 * tab, so a single oversized frame takes every unrelated subscription on that
 * tab down with it. That is a whole-connection death sentence issued by the
 * layer BELOW the per-request defect isolation `disableFatalDefects` buys us —
 * the isolation story inverted at the framing layer.
 *
 * It shipped as a production incident: a 26 MB drag-and-drop rode one
 * `scratch.write` frame and blanked the terminal pane
 * (`1009: MaxBufferSizeExceeded: RPC serialization buffer exceeded the maximum
 * size of 16777216`).
 *
 * ## Why the value is what it is
 *
 * `RPC_MAX_FRAME_BYTES` is set to Effect's own beta.103 default, 16 MiB, and
 * that equality is the POINT rather than a coincidence: passing it explicitly
 * at every site means a future bump that changes the default cannot move
 * kolu's wire silently. The number stops being Effect's and starts being ours.
 *
 * Raising it was considered and rejected. A cap only converts "one huge frame"
 * into "one huger frame" — the fix for payloads that scale with user content is
 * to stop letting any single frame scale with user content at all (see
 * `@kolu/padi`'s `UPLOAD_CHUNK_BYTES`, derived FROM this constant). The cap is
 * the backstop, not the budget.
 *
 * ## The measurement behind the marker
 *
 * BETA-ASSUMPTION(beta.103): an ndjson frame over `maxBufferSize` closes the socket with code 1009 rather than failing the single oversized call.
 *
 * Measured against `effect@4.0.0-beta.103`:
 *   - `dist/unstable/rpc/RpcSerialization.js` — `defaultMaxBufferSize = 16 * 1024 * 1024`,
 *     `isBufferSizeExceeded(size, max) => max !== "unbounded" && size > max`
 *     (strictly greater, so a frame EXACTLY at the cap is accepted).
 *   - `dist/unstable/rpc/RpcServer.js` — the inbound decode's catch turns a
 *     `MaxBufferSizeExceeded` into `writeRaw(new Socket.CloseEvent(1009, …))`.
 *     It is the only `1009` in the whole `effect` dist.
 *   - `dist/unstable/rpc/RpcClient.js` — the CLIENT leg has no 1009 path: the
 *     same overflow surfaces as an `RpcClientDefect`. The close-the-socket
 *     semantics are therefore asymmetric, client→server only.
 *
 * If a bump changes any of that — a different default, a typed per-call failure
 * instead of a close, a different close code — the chunking margins below and
 * the client-side refusal both need re-deriving, which is what the marker
 * forces.
 *
 * The cap counts UTF-16 code units of the decoded frame text, not UTF-8 bytes
 * (`buffer` is a JS string and the check is `nlIndex - position`). For the
 * base64 and ASCII-JSON payloads that get anywhere near the cap the two are
 * equal, and where they differ a code unit is never MORE than a UTF-8 byte, so
 * treating the cap as a byte budget is conservative in the safe direction.
 */

import { RpcSerialization } from "effect/unstable/rpc";

/** The ndjson decode buffer cap, in bytes — 16 MiB. Passed explicitly wherever
 *  a serialization layer is built so Effect's default never applies by
 *  accident. See this module's header for the derivation and the beta marker. */
export const RPC_MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** The ONE ndjson serialization layer for every link leg — client and server,
 *  websocket / unix socket / stdio. Use this instead of
 *  `RpcSerialization.layerNdjson`, whose cap is Effect's default rather than
 *  ours. */
export const rpcSerializationLayer = RpcSerialization.layerNdjsonWith({
  maxBufferSize: RPC_MAX_FRAME_BYTES,
});

/** The WebSocket close code the server sends when an inbound frame busts the
 *  cap — RFC 6455's "message too big". Effect emits it from exactly one place
 *  (`RpcServer`'s inbound-decode catch) and it is the only 1009 in the dist, so
 *  seeing it on the wire means this and nothing else.
 *
 *  It is named here so the client can classify it DISTINCTLY rather than
 *  treating it as an anonymous disconnect. Crucially it must NOT be a terminal
 *  close: a terminal close halts the retry schedule, and halting here would
 *  leave the tab permanently subscription-less after one bad frame. A 1009 is a
 *  recoverable transport death — reconnect, re-subscribe, and let the
 *  per-subscription retry fence restore what was lost. */
export const FRAME_TOO_LARGE_CLOSE_CODE = 1009;

/** Was this close the frame-cap close? */
export function isFrameTooLargeClose(code: number): boolean {
  return code === FRAME_TOO_LARGE_CLOSE_CODE;
}

/** Would a frame of `bytes` be refused by the decoder?
 *
 *  Mirrors Effect's own predicate EXACTLY, including the strictness: a frame of
 *  precisely `RPC_MAX_FRAME_BYTES` is accepted, one byte more is not. A caller
 *  that refuses at `>=` would reject frames the wire would have carried, and a
 *  caller that refuses at `>` + 1 would hand the wire a frame that kills it. */
export function exceedsFrameLimit(bytes: number): boolean {
  return bytes > RPC_MAX_FRAME_BYTES;
}
