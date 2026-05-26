/**
 * Stdio framing for the oRPC standard-peer protocol.
 *
 * Each message is base64-encoded on one line; newlines delimit
 * messages. Base64 never contains a newline, so the framing is
 * unambiguous over the byte stream. Handles both string and binary
 * payloads uniformly.
 *
 * Used by:
 *  - `agent.ts` — wires `ServerPeer` (from `@orpc/standard-server-peer`)
 *    to `process.stdin` / `process.stdout`.
 *  - `host-session.ts` — wires `ClientPeer` to the `ssh` subprocess's
 *    `stdin` / `stdout`.
 *
 * The two sides use the same framing, so a `kolu agent --stdio`
 * spawned over ssh can be talked to by any `ClientPeer` with this
 * adapter.
 */

import type { Readable, Writable } from "node:stream";
import type { EncodedMessage } from "@orpc/standard-server-peer";
import { log } from "../log.ts";

/** Build the `send` callback for a peer: encodes the message as base64
 *  and writes to `out` with a newline delimiter. */
export function makeStdioSend(out: Writable): (msg: EncodedMessage) => void {
  return (msg) => {
    const buf =
      typeof msg === "string"
        ? Buffer.from(msg, "utf8")
        : Buffer.isBuffer(msg)
          ? msg
          : Buffer.from(msg as ArrayBufferLike);
    out.write(buf.toString("base64"));
    out.write("\n");
  };
}

/** Read messages from `inp` line-by-line, decode each line as base64,
 *  and call `onMessage(decoded)` for each. Returns a stop function
 *  that detaches the listener. */
export function readStdioMessages(
  inp: Readable,
  onMessage: (msg: Uint8Array) => void | Promise<void>,
  onClose?: () => void,
): () => void {
  let buf = "";
  const onData = (chunk: Buffer | string) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        try {
          const decoded = Buffer.from(line, "base64");
          void onMessage(decoded);
        } catch (err) {
          // Recover at next newline — a malformed frame shouldn't poison
          // the rest of the stream — but surface the error so a protocol
          // mismatch isn't invisible. `frameLength` helps diagnose
          // truncation / encoding skew at the framing layer.
          log.warn(
            { err, frameLength: line.length },
            "stdio-peer: malformed frame; skipping",
          );
        }
      }
      nl = buf.indexOf("\n");
    }
  };
  inp.on("data", onData);
  if (onClose) {
    inp.once("end", onClose);
    inp.once("close", onClose);
  }
  return () => {
    inp.off("data", onData);
  };
}
