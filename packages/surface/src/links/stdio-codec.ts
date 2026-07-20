/**
 * Stdio wire-framing codec — base64 + newline, shared by the two sides of the
 * stdio transport: the client link (`./stdio.ts`) and the server peer
 * (`../peer-server.ts`). It is the single home for the framing change-axis
 * (delimiter, encoding, escaping); both sides import it so they can never
 * drift. **Package-internal** — not re-exported through any `@kolu/surface/*`
 * subpath, so framing primitives don't leak onto the link's public surface.
 *
 * Why base64+newline? The underlying peer codec emits `string |
 * ArrayBufferLike | Uint8Array` per message. ssh stdin/stdout is a byte
 * stream with no framing of its own, so two things must hold:
 *   1. Binary safety — message bytes can include `\n`, NUL, etc.; raw
 *      bytes would corrupt frame delineation.
 *   2. Frame boundaries — each message gets exactly one delimiter.
 * Base64 produces ASCII bytes that never contain `\n`, then we append a
 * newline. Decoder reads line-by-line and base64-decodes each line back
 * to the original `Uint8Array` the peer expects.
 */

import type { Readable, Writable } from "node:stream";
import { ORPCError } from "@orpc/client";

/** Encode a single peer message into a single base64 line (no trailing
 *  newline — the caller appends it). */
export function encodeFrame(
  message: string | ArrayBufferLike | Uint8Array,
): string {
  if (typeof message === "string") {
    return Buffer.from(message, "utf-8").toString("base64");
  }
  if (message instanceof Uint8Array) {
    return Buffer.from(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    ).toString("base64");
  }
  return Buffer.from(message).toString("base64");
}

/** Decode one base64 line back into a `Uint8Array` for the peer codec. */
export function decodeFrame(line: string): Uint8Array {
  return new Uint8Array(Buffer.from(line, "base64"));
}

/** Frame one peer message and write it to `write` as a single base64 line.
 *  The write half's counterpart to `encodeFrame` + the newline delimiter:
 *  it keeps the wire framing (`encodeFrame(message)` + `"\n"`) in the codec's
 *  one home rather than open-coded at each call site — the client link and
 *  the server peer both send through here so the delimiter/encoding can never
 *  drift between them.
 *
 *  Deliberately framing-only: it resolves/rejects on the *write callback*
 *  (this one frame flushed, or it didn't), and attaches NO stream `'error'`
 *  listener. A dead write stream is a transport-lifecycle concern whose
 *  response differs per consumer (the client closes its link; the server
 *  ends its serve loop), so each side owns that guard locally — see the
 *  `write.on("error", …)` handlers in `./stdio.ts` and `../peer-server.ts`.
 *  The read half's lifecycle split is documented on `readFramedLines`. */
function writeFramedMessage(
  write: Writable,
  message: string | ArrayBufferLike | Uint8Array,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    write.write(`${encodeFrame(message)}\n`, (err) =>
      err == null ? resolve() : reject(err),
    );
  });
}

/** A write failure whose destination is simply gone — the peer closed its end
 *  (`EPIPE`) or our own stream was already destroyed (`ERR_STREAM_DESTROYED`).
 *  Benign during teardown: there is nothing left to deliver. Every other write
 *  error is a real failure and still propagates. */
export function isBenignWriteError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED";
}

/** The send half both peers hand to `ClientPeer` / `ServerPeer`: frame and
 *  write a message, but treat a dead-pipe teardown write (`isBenignWriteError`)
 *  as delivery-impossible rather than exceptional — the peer is gone, the
 *  frame can't be delivered. Without neutralizing the un-deliverable frame
 *  here, its rejection escapes the peer's internal send path as an unhandled
 *  rejection and crashes the process on lane teardown after an otherwise-green
 *  run (juspay/odu#32, the residual of #25).
 *
 *  `onPeerGone` is how the benign failure still reaches the consumer's
 *  lifecycle owner. The stream `'error'` handlers alone are NOT enough:
 *  Node reports a `write()` on a stream that was previously `destroy()`ed
 *  without an error ONLY to the write callback (`ERR_STREAM_DESTROYED`) —
 *  no `'error'` event fires — so a swallow-only send would leave both sides
 *  deaf to the death (the server's serve promise pending forever, the
 *  client's in-flight calls hanging). Each consumer passes its own teardown:
 *  the server destroys its read stream (ending the serve loop as a clean
 *  `"end"`), the client marks the link closed. Must be idempotent — the
 *  stream `'error'` path can fire for the same death.
 *
 *  This keeps the framing/lifecycle split intact: `writeFramedMessage` stays
 *  framing-only, and the per-side teardown *response* stays the consumer's,
 *  supplied as a value. Only the write whose destination is already gone is
 *  swallowed; every other write error still propagates.
 *
 *  `onPeerGone` is REQUIRED, not optional: an omitted callback would be a
 *  send whose lifecycle owner is deaf by default — the exact hang this
 *  parameter exists to kill, re-expressible at any future call site. Every
 *  consumer must choose its teardown response in the type system; a
 *  genuinely ownerless caller (a narrow unit test) says so explicitly with
 *  a no-op. */
export function framedSend(
  write: Writable,
  message: string | ArrayBufferLike | Uint8Array,
  onPeerGone: () => void,
): Promise<void> {
  return writeFramedMessage(write, message).catch((err: unknown) => {
    if (!isBenignWriteError(err)) throw err;
    onPeerGone();
  });
}

/** Read line-delimited frames off `read` until the stream ends. Each
 *  non-empty line is base64-decoded and dispatched to `onFrame`. Returns
 *  a Promise that resolves on `'end'` OR `'close'` and rejects on `'error'`.
 *
 *  Invariant — SETTLED ⟹ STOPPED (#1859): every way this promise settles is
 *  CAUSED by the read stream terminating, so a settled read can never keep
 *  dispatching. `'end'`/`'close'`/`'error'` are stream terminations by
 *  definition; the one path that isn't — a synchronous throw out of `onFrame`
 *  — settles by `read.destroy(err)`, which routes through the same `'error'`
 *  listener AND stops the stream. There is no bare `reject()` that could leave
 *  the reader alive (the pre-#1859 zombie: promise rejected, stream still
 *  flowing frames into a consumer that already tore down).
 *
 *  Why the codec owns this response inline (vs. the write half's per-consumer
 *  guard): a frame-processing failure here has ONE uniform response for every
 *  consumer — stop the reader (`read.destroy(err)`) — so it belongs in the
 *  codec, whereas a dead *write* stream's response differs per consumer (client
 *  closes its link, server ends its serve loop) and stays in each caller's
 *  `write.on("error", …)`. The rule is "uniform response ⇒ in the codec,
 *  per-consumer response ⇒ in the callback", not "framing in the codec,
 *  lifecycle in the callback" — do not "fix" the catch below back to a bare
 *  reject on that misreading.
 *
 *  The `'close'` edge is part of the declared contract, not an accident: a
 *  `destroy()` with no error emits neither `'end'` nor `'error'` — only
 *  `'close'` — so without it the promise would hang forever. Peer-server's
 *  error-free `endServing()` teardown (the `onPeerGone` path) load-bears on
 *  exactly this edge — it is how a callback-only write death settles as
 *  `reason: "end"`; do not drop the `'close'` handler in a refactor.
 *
 *  Why hand-roll instead of `readline`: `readline` adds another async
 *  layer and obscures the framing assumption. The whole protocol is
 *  "one base64 line = one frame", and the loop expressing it directly is
 *  20 lines. */
export async function readFramedLines(
  read: Readable,
  onFrame: (frame: Uint8Array) => void,
): Promise<void> {
  read.setEncoding("utf-8");
  let buffer = "";
  return new Promise<void>((resolve, reject) => {
    read.on("data", (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (line.length === 0) continue;
        try {
          onFrame(decodeFrame(line));
        } catch (err) {
          // Destroy the stream WITH the error so settlement routes through the
          // still-attached `read.on("error", reject)` below; `return` abandons
          // the rest of this in-flight chunk. Why this preserves "settled ⟹
          // stopped" is proved in the `readFramedLines` docstring above.
          read.destroy(
            new ORPCError("SURFACE_STDIO_FRAME_HANDLER_FAILED", {
              message: `An inbound stdio frame handler (\`onFrame\`) threw synchronously, so the reader has been stopped and its stream destroyed. Underlying error: ${(err as Error).message}`,
              cause: err,
            }),
          );
          return;
        }
      }
    });
    read.on("end", resolve);
    read.on("close", resolve);
    read.on("error", reject);
  });
}
