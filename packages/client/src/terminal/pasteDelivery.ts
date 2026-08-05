/** Paste/upload delivery — the client-side recomposition of the retired server
 *  `pasteImage`/`uploadFile` handlers: write pasted/dropped bytes into the
 *  terminal's on-disk scratch dir, then bracketed-paste the returned path into
 *  the PTY.
 *
 *  `lifecycle.sendInput` QUIET-DROPS on a terminal that is no longer active —
 *  server-side it is `getActiveTerminal(id)?.handle.write(...)`, and the `?.`
 *  short-circuits (no throw, no return) when the id is not an active terminal.
 *  So a terminal that dies AFTER the scratch write but BEFORE the send would
 *  swallow the paste with NO error: the file is written but the paste never
 *  lands. The retired single RPC threw NOT_FOUND in that case.
 *
 *  Restore an observable failure: re-check the terminal is active after the
 *  write (awaiting the drop would resolve silently, so it must be gated here)
 *  and throw otherwise, so the caller's catch surfaces a `toast.error` rather
 *  than dropping the written file in silence. On a live terminal the success
 *  path is unchanged — write then send.
 *
 *  ## Why the write is a LOOP (juspay/kolu#2101 G9a)
 *
 *  The bytes used to ride ONE `scratch.write` call. That made the request frame
 *  scale with the dropped file, and Effect RPC's ndjson decoder does not fail an
 *  oversized frame — it CLOSES THE SOCKET with 1009. Every surface multiplexes
 *  onto one socket per tab, so a 26 MB drop did not fail an upload, it killed
 *  every subscription the tab had (production incident: the terminal pane
 *  blanked mid-drop).
 *
 *  So the base64 is split into `UPLOAD_CHUNK_BYTES`-bounded pieces and sent in
 *  order: the first call creates the file, each later one passes back the path
 *  it was handed and appends. The chunks are SEQUENTIAL, not concurrent — the
 *  server appends to one growing file, so two chunks in flight would interleave
 *  their bytes and silently corrupt the upload. Effect's generator does this by
 *  construction: each `yield*` awaits the previous chunk's answer.
 *
 *  Extracted from Terminal.tsx so the delivery gate is unit-testable without an
 *  xterm/DOM harness (Terminal.tsx cannot be imported under the node runner). */

import { chunkBase64, UPLOAD_CHUNK_BASE64_CHARS } from "@kolu/padi/upload";
import {
  exceedsFrameLimit,
  RPC_MAX_FRAME_BYTES,
} from "@kolu/surface/frame-limit";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";

/** Bytes of JSON envelope budgeted around a chunk's payload — procedure path,
 *  request id, terminal id, the scratch path, the filename, and JSON's quoting.
 *  Generous on purpose: it is the same 64 KiB ceiling `UPLOAD_CHUNK_BYTES`'
 *  derivation reserves, so the two sides of the margin agree. */
const FRAME_ENVELOPE_BUDGET_BYTES = 64 * 1024;

/** The pre-send refusal (G9b).
 *
 *  Every chunk is bounded by construction, so this should be UNREACHABLE — and
 *  that is precisely why it is here rather than trusted away. It is the guard
 *  that turns a future derivation mistake (a bumped chunk size, a fatter
 *  envelope, a base64 expansion someone re-derives wrong) into an honest toast
 *  on one upload instead of a dead socket and a blank pane. The transport must
 *  never be the thing that discovers a frame is too big.
 *
 *  Returns a message when the frame would be refused by the wire, else null. */
export function oversizedFrameRefusal(
  label: string,
  base64Chars: number,
): string | null {
  const frameBytes = base64Chars + FRAME_ENVELOPE_BUDGET_BYTES;
  if (!exceedsFrameLimit(frameBytes)) return null;
  const mib = (n: number) => (n / (1024 * 1024)).toFixed(1);
  return `Couldn't upload "${label}" — one piece of it came to ${mib(frameBytes)} MB and the connection's limit is ${mib(RPC_MAX_FRAME_BYTES)} MB. Nothing was sent. That's a bug, please report it.`;
}

export function deliverScratchPaste(deps: {
  terminalId: TerminalId;
  name: string;
  base64: string;
  scratchWrite: (args: {
    terminalId: TerminalId;
    name: string;
    data: string;
    /** Absent on the first chunk (create); the previous answer's path on every
     *  later one (append). */
    appendTo?: string;
  }) => Effect.Effect<{ path: string }, unknown>;
  /** Is the terminal still an ACTIVE (live-PTY) terminal — the client mirror of
   *  the server's `getActiveTerminal` gate. */
  isActive: () => boolean;
  sendInput: (args: {
    id: TerminalId;
    data: string;
  }) => Effect.Effect<void, unknown>;
  /** Wrap the scratch path in the bracketed-paste markers. */
  wrapPath: (path: string) => string;
  /** Base64 characters per chunk. Defaults to the derived
   *  `UPLOAD_CHUNK_BASE64_CHARS`, and production never passes anything else.
   *  It is a parameter so the pre-send refusal below is REACHABLE in a test:
   *  the failure that guard exists for is a bad chunk size, and a guard nobody
   *  can drive is a guard nobody knows works. */
  chunkChars?: number;
}): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const chunks = chunkBase64(
      deps.base64,
      deps.chunkChars ?? UPLOAD_CHUNK_BASE64_CHARS,
    );

    // Refuse BEFORE the first byte goes out, not chunk by chunk: a refusal
    // halfway through would leave a partial file on disk that the agent could
    // read as whole. The check is on the largest chunk, which is every chunk
    // but the last.
    const refusal = oversizedFrameRefusal(deps.name, chunks[0]?.length ?? 0);
    if (refusal !== null) return yield* Effect.fail(new Error(refusal));

    let path: string | undefined;
    for (const data of chunks) {
      const answer = yield* deps.scratchWrite({
        terminalId: deps.terminalId,
        name: deps.name,
        data,
        ...(path === undefined ? {} : { appendTo: path }),
      });
      path = answer.path;
    }
    // `chunkBase64` returns at least one piece, so the loop always ran and
    // `path` is always set. Assert rather than defaulting: a silent `?? ""`
    // here would bracketed-paste an empty path into the PTY.
    if (path === undefined) {
      return yield* Effect.fail(
        new Error("upload produced no chunks — nothing was written"),
      );
    }
    // The liveness re-check sits BETWEEN the two calls, where it has to: the
    // send is the step that quiet-drops, so the refusal has to be raised before
    // it, not inferred from its (always successful) answer.
    if (!deps.isActive())
      return yield* Effect.fail(
        new Error("terminal is no longer active — paste not delivered"),
      );
    yield* deps.sendInput({ id: deps.terminalId, data: deps.wrapPath(path) });
  });
}
