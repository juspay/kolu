import { formatMiB } from "@kolu/byte-units";
import {
  chunkBase64,
  FRAME_CHUNK_BASE64_CHARS,
  frameBytesFor,
} from "@kolu/surface/frame-chunking";
import {
  exceedsFrameLimit,
  RPC_MAX_FRAME_BYTES,
} from "@kolu/surface/frame-limit";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";

export function oversizedFrameRefusal(
  label: string,
  base64Chars: number,
): string | null {
  const frameBytes = frameBytesFor(base64Chars);
  if (!exceedsFrameLimit(frameBytes)) return null;
  return `Couldn't upload "${label}" — one piece of it came to ${formatMiB(frameBytes, 1)} and the connection's limit is ${formatMiB(RPC_MAX_FRAME_BYTES, 1)}. Nothing was sent. That's a bug, please report it.`;
}

export interface ScratchPasteDeps {
  terminalId: TerminalId;
  name: string;
  base64: string;
  scratchWrite: (args: {
    terminalId: TerminalId;
    name: string;
    data: string;
    appendTo?: string;
  }) => Effect.Effect<{ path: string }, unknown>;
  isActive: () => boolean;
  sendInput: (args: {
    id: TerminalId;
    data: string;
  }) => Effect.Effect<void, unknown>;
  /** Wrap the scratch path in the bracketed-paste markers. */
  wrapPath: (path: string) => string;
}

function writeScratchInFrames(
  deps: ScratchPasteDeps,
): Effect.Effect<string, unknown> {
  return Effect.gen(function* () {
    const frames = chunkBase64(deps.base64, FRAME_CHUNK_BASE64_CHARS);

    const refusal = oversizedFrameRefusal(deps.name, frames[0]?.length ?? 0);
    if (refusal !== null) return yield* Effect.fail(new Error(refusal));

    let path: string | undefined;
    for (const data of frames) {
      const answer = yield* deps.scratchWrite({
        terminalId: deps.terminalId,
        name: deps.name,
        data,
        ...(path === undefined ? {} : { appendTo: path }),
      });
      path = answer.path;
    }
    if (path === undefined) {
      return yield* Effect.fail(
        new Error("upload produced no frames — nothing was written"),
      );
    }
    return path;
  });
}

function requireActiveTerminal(
  isActive: () => boolean,
): Effect.Effect<void, Error> {
  return Effect.suspend(() =>
    isActive()
      ? Effect.void
      : Effect.fail(
          new Error("terminal is no longer active — paste not delivered"),
        ),
  );
}

export function deliverScratchPaste(
  deps: ScratchPasteDeps,
): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const path = yield* writeScratchInFrames(deps);
    yield* requireActiveTerminal(deps.isActive);
    yield* deps.sendInput({ id: deps.terminalId, data: deps.wrapPath(path) });
  });
}
