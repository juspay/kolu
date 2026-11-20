import {
  chunkBase64,
  FRAME_CHUNK_BASE64_CHARS,
} from "@kolu/surface/frame-chunking";
import { Effect } from "effect";
import { oversizedFrameRefusal } from "../terminal/pasteDelivery";
import { app } from "../wire";
import type { ReadFile } from "./attachments";

export interface WrittenAttachment {
  readonly path: string;
  readonly bytes: number;
}

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
    appendTo?: string;
  }) => Effect.Effect<WrittenAttachment, unknown>;
  readonly chunker?: (base64: string) => readonly string[];
}): Effect.Effect<WrittenAttachment, unknown> {
  return Effect.gen(function* () {
    const chunk =
      deps.chunker ??
      ((base64: string) => chunkBase64(base64, FRAME_CHUNK_BASE64_CHARS));
    const chunks = chunk(deps.base64);

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
    if (written === undefined) {
      return yield* Effect.fail(
        new Error("the upload produced no chunks — nothing was written"),
      );
    }
    return written;
  });
}

export function sendAttachment(
  read: ReadFile,
): Effect.Effect<WrittenAttachment, unknown> {
  return uploadAttachment({
    id: read.id,
    name: read.name,
    mimeType: read.mimeType,
    base64: read.base64,
    attach: (args) => app.procedures.conductor.attach(args),
  });
}
