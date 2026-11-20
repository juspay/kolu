import { Effect } from "effect";
import { toast } from "solid-sonner";
import { runAction } from "../runAction";
import {
  attachmentRefusal,
  mimeTypeOf,
  mintAttachmentId,
  pastedAttachmentName,
  pastedAttachments,
  readForUpload,
} from "./attachments";
import { sendAttachment } from "./attachmentUpload";
import {
  addComposerAttachment,
  composerAttachmentBytes,
  composerAttachments,
  dropComposerAttachment,
  settleComposerAttachment,
  unsettleComposerAttachments,
} from "./drafts";
import { rememberThumbnail } from "./thumbnails";

interface Candidate {
  readonly file: File;
  readonly name: string;
}

function uploadOrDropChip(
  file: File,
  name: string,
  id: string,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const read = yield* Effect.tryPromise(() =>
      readForUpload(file, name, id),
    ).pipe(
      Effect.catch((err: unknown) =>
        Effect.sync(() => {
          toast.error(
            `Could not attach “${name}”: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }),
      ),
    );
    if (read === null) {
      dropComposerAttachment(id);
      return;
    }
    rememberThumbnail(read, read.dataUrl);
    yield* sendAttachment(read).pipe(
      Effect.tap((written) =>
        Effect.sync(() => settleComposerAttachment(id, written)),
      ),
      Effect.catch((err: unknown) =>
        Effect.sync(() => {
          dropComposerAttachment(id);
          toast.error(
            `Could not attach “${name}”: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      ),
    );
  });
}

function admitOneAtATime(
  candidates: readonly Candidate[],
): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (const candidate of candidates) {
      const why = attachmentRefusal(
        { name: candidate.name, bytes: candidate.file.size },
        composerAttachmentBytes(),
      );
      if (why !== null) {
        toast.error(why);
        continue;
      }
      const id = mintAttachmentId();
      addComposerAttachment({
        id,
        name: candidate.name,
        mimeType: mimeTypeOf(candidate.file),
        bytes: candidate.file.size,
        path: null,
        file: candidate.file,
      });
      yield* uploadOrDropChip(candidate.file, candidate.name, id);
    }
  });
}

export function reattachComposerFiles(): void {
  const rows = composerAttachments();
  if (rows.length === 0) return;
  unsettleComposerAttachments();
  runAction(
    "conductor re-attach",
    Effect.gen(function* () {
      for (const row of rows) {
        yield* uploadOrDropChip(row.file, row.name, row.id);
      }
    }),
  );
}

export function attachPastedFiles(data: DataTransfer | null): boolean {
  if (data === null) return false;
  const items = pastedAttachments([...data.items]);
  const now = new Date();
  const candidates = items.flatMap((item) => {
    const file = item.getAsFile();
    return file === null
      ? []
      : [{ file, name: pastedAttachmentName(file.type, now) }];
  });
  if (candidates.length === 0) return false;
  runAction("conductor attach", admitOneAtATime(candidates));
  return true;
}

export function attachDroppedFiles(files: readonly File[]): boolean {
  const now = new Date();
  const candidates = files.map((file) => ({
    file,
    name: file.name === "" ? pastedAttachmentName(file.type, now) : file.name,
  }));
  if (candidates.length === 0) return false;
  runAction("conductor attach", admitOneAtATime(candidates));
  return true;
}
