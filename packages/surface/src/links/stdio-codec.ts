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
 *  The read half splits the same way: `decodeFrame` is framing, the
 *  `read.on("error", …)` in `readFramedLines` is lifecycle. */
export function writeFramedMessage(
  write: Writable,
  message: string | ArrayBufferLike | Uint8Array,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    write.write(`${encodeFrame(message)}\n`, (err) =>
      err == null ? resolve() : reject(err),
    );
  });
}

/** Read line-delimited frames off `read` until the stream ends. Each
 *  non-empty line is base64-decoded and dispatched to `onFrame`. Returns
 *  a Promise that resolves on `'end'` and rejects on `'error'`.
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
          reject(
            new ORPCError("SURFACE_STDIO_FRAME_DECODE_FAILED", {
              message: `Failed to base64-decode an inbound stdio frame. The peer on the other end likely wrote non-protocol bytes to its protocol channel (e.g. logged to stdout instead of stderr — see lesson #4). Underlying error: ${(err as Error).message}`,
              cause: err,
            }),
          );
        }
      }
    });
    read.on("end", resolve);
    read.on("close", resolve);
    read.on("error", reject);
  });
}
