/** Getting an attachment's BYTES to padi — in pieces, before the prompt that
 *  names it is sent.
 *
 *  ## Why this is a LOOP and not one call
 *
 *  The base64 used to ride the `orchestrator.prompt` frame. That made the
 *  request frame scale with the pasted image, and Effect RPC's ndjson decoder
 *  does not fail an oversized frame — it CLOSES THE SOCKET with 1009. Every
 *  surface multiplexes onto one socket per tab, so a policy-legal 12 MiB of
 *  screenshots would not have failed a send, it would have killed every
 *  subscription the tab had: the transcript, the fleet, the terminals. The
 *  terminal's drop paid for that lesson in production
 *  (`terminal/pasteDelivery.ts` is the write-up); this is the same shape, not
 *  a second mechanism.
 *
 *  So the bytes go up when the file is ATTACHED, split into
 *  `FRAME_CHUNK_BASE64_CHARS`-bounded pieces sent IN ORDER: the first call
 *  creates the file under padi's state root, each later one passes back the
 *  path it was handed and appends. The chunks are SEQUENTIAL, not concurrent —
 *  the server appends to one growing file, so two chunks in flight would
 *  interleave their bytes and silently corrupt the upload. Effect's generator
 *  does this by construction: each `yield*` awaits the previous chunk's answer.
 *
 *  The prompt then carries only what the wire contract still has — id, name,
 *  mime, size and the path padi answered with — so a prompt frame is the size
 *  of its words whatever is attached to it.
 *
 *  `bytes` comes back from padi rather than from `file.size`: the cap is
 *  enforced on what was actually WRITTEN, and a chip that quotes the sender's
 *  claim instead of the server's count is a chip that can disagree with the
 *  file the agent reads. */

import {
  chunkBase64,
  FRAME_CHUNK_BASE64_CHARS,
} from "@kolu/surface/frame-chunking";
import { Effect } from "effect";
import { oversizedFrameRefusal } from "../terminal/pasteDelivery";
import { app } from "../wire";
import type { ReadFile } from "./attachments";

/** What padi wrote, and where. */
export interface WrittenAttachment {
  readonly path: string;
  readonly bytes: number;
}

/** The chunked upload itself, with its one wire call injected — so the
 *  sequencing, the appending and the pre-send refusal are exercised without an
 *  open socket. */
export function uploadAttachment(deps: {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly base64: string;
  readonly attach: (args: {
    id: string;
    name: string;
    mimeType: string;
    data: string;
    /** Absent on the first chunk (create); the previous answer's path on every
     *  later one (append). */
    appendTo?: string;
  }) => Effect.Effect<WrittenAttachment, unknown>;
  /** Base64 characters per chunk. Defaults to the derived
   *  `FRAME_CHUNK_BASE64_CHARS`, and production never passes anything else. It
   *  is a parameter so the pre-send refusal below is REACHABLE in a test: the
   *  failure that guard exists for is a bad chunk size, and a guard nobody can
   *  drive is a guard nobody knows works. */
  readonly chunkChars?: number;
}): Effect.Effect<WrittenAttachment, unknown> {
  return Effect.gen(function* () {
    const chunks = chunkBase64(
      deps.base64,
      deps.chunkChars ?? FRAME_CHUNK_BASE64_CHARS,
    );

    // Refuse BEFORE the first byte goes out, not chunk by chunk: a refusal
    // halfway through would leave a partial file on disk that a prompt could
    // still name. The check is on the largest chunk, which is every chunk but
    // the last.
    const refusal = oversizedFrameRefusal(deps.name, chunks[0]?.length ?? 0);
    if (refusal !== null) return yield* Effect.fail(new Error(refusal));

    let written: WrittenAttachment | undefined;
    for (const data of chunks) {
      written = yield* deps.attach({
        id: deps.id,
        name: deps.name,
        mimeType: deps.mimeType,
        data,
        ...(written === undefined ? {} : { appendTo: written.path }),
      });
    }
    // `chunkBase64` returns at least one piece, so the loop always ran. Assert
    // rather than defaulting: a silent `?? ""` here would put a chip with no
    // file behind it in the composer, which is the one lie this whole path
    // exists to prevent.
    if (written === undefined) {
      return yield* Effect.fail(
        new Error("the upload produced no chunks — nothing was written"),
      );
    }
    return written;
  });
}

/** The production edge: the same upload, against kolu-server — the one host of
 *  the one conversation, so the bytes land beside the transcript that will
 *  name them. */
export function sendAttachment(
  read: ReadFile,
): Effect.Effect<WrittenAttachment, unknown> {
  return uploadAttachment({
    id: read.id,
    name: read.name,
    mimeType: read.mimeType,
    base64: read.base64,
    attach: (args) => app.procedures.orchestrator.attach(args),
  });
}
