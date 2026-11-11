/** Taking files INTO the composer's draft — the one path a paste and a drop
 *  both run through.
 *
 *  Four modules, four jobs: `attachments.ts` decides and reads, `drafts.ts`
 *  holds what is not yet sent, `attachmentUpload.ts` gets the bytes to kolu-server,
 *  and this is the seam between them — the only place that says no out loud. A
 *  refused file is a toast with the sentence the policy wrote, never a silent
 *  drop: a chip that simply failed to appear is indistinguishable from a paste
 *  the browser never delivered.
 *
 *  THE BYTES GO UP HERE, not with the prompt. A chip appears the moment the
 *  file is read and says it is still uploading until kolu-server answers with a path;
 *  an upload that fails takes its chip away and says why. The alternative —
 *  a chip that looks ready with nothing behind it — is the worst of the
 *  available lies, because the prompt it rides would name a file the agent
 *  cannot read. The same rule is why {@link reattachComposerFiles} exists: a
 *  REFUSED prompt makes kolu-server delete what it named, so the chips that survive
 *  the refusal have to put their bytes back before they mean anything. */

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

/** A file on its way in, under the name it will wear. */
interface Candidate {
  readonly file: File;
  readonly name: string;
}

/** Read one file and put its bytes on the host, under `id`.
 *
 *  The chip is added by the caller BEFORE this runs (and already exists on a
 *  re-attach), so what this owns is the one transition that matters: a chip
 *  that says "uploading" becomes a chip with a path, or it comes off entirely
 *  with a sentence saying why. There is no third state — a chip that looks
 *  ready with nothing behind it would put a path kolu-server cannot read on the next
 *  prompt. */
function putOnHost(file: File, name: string, id: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    const read = yield* Effect.tryPromise(() =>
      readForUpload(file, name, id),
    ).pipe(
      Effect.catch((err: unknown) =>
        Effect.sync(() => {
          // The server's own sentence, kept: a declared refusal carries its
          // `why` as its `message`.
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
          // The chip COMES OFF. Leaving it would leave a message a person
          // believes carries their image and kolu-server has no file for.
          dropComposerAttachment(id);
          toast.error(
            `Could not attach “${name}”: ${err instanceof Error ? err.message : String(err)}`,
          );
        }),
      ),
    );
  });
}

/** Admit what fits, one at a time.
 *
 *  SEQUENTIAL on purpose, twice over. The per-message cap is measured against
 *  what the draft already holds, so reading three files in parallel and judging
 *  all three against the draft as it was before any of them landed is how
 *  twelve megabytes of screenshots get in under a twenty-megabyte cap. And the
 *  uploads themselves must not interleave either: kolu-server appends each chunk to a
 *  growing file, so two files going up at once is two sets of chunks arriving
 *  in a shuffle. Effect's generator gives both by construction — each `yield*`
 *  awaits the previous answer. */
function take(candidates: readonly Candidate[]): Effect.Effect<void> {
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
      // The chip goes up BEFORE the bytes do, and says so. A pasted screenshot
      // that leaves no mark for the seconds its upload takes is a paste a
      // person retries, and two copies of one image is what they get for it.
      const id = mintAttachmentId();
      addComposerAttachment({
        id,
        name: candidate.name,
        mimeType: mimeTypeOf(candidate.file),
        bytes: candidate.file.size,
        path: null,
        file: candidate.file,
      });
      yield* putOnHost(candidate.file, candidate.name, id);
    }
  });
}

/** PUT THE DRAFT'S BYTES BACK, after a prompt was refused.
 *
 *  kolu-server deletes every file a refused prompt named — it will not leave an
 *  attachment the transcript does not name — so the chips a person is still
 *  looking at are chips whose paths point at nothing. They are re-uploaded
 *  under the SAME ids (the create truncates), so the next Send names files
 *  that are really there instead of being refused for something the person
 *  cannot see or fix.
 *
 *  One at a time again, for the same reason the first upload was. */
export function reattachComposerFiles(): void {
  const rows = composerAttachments();
  if (rows.length === 0) return;
  unsettleComposerAttachments();
  runAction(
    "orchestrator re-attach",
    Effect.gen(function* () {
      for (const row of rows) {
        yield* putOnHost(row.file, row.name, row.id);
      }
    }),
  );
}

/** Take the files off a paste. Answers whether the paste BELONGED to the
 *  attachments — a `false` leaves the event alone so the textarea pastes text
 *  the way a textarea should.
 *
 *  Every pasted file is renamed: the browser hands every screenshot over as
 *  `image.png`, and three identically-named chips are three chips nobody can
 *  tell apart. */
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
  runAction("orchestrator attach", take(candidates));
  return true;
}

/** Take the files off a drop. A dropped file HAS a name — the one the person
 *  can see in their file manager — and keeping it is the whole reason the chip
 *  is worth reading. A file with no name at all (a drag from a source that
 *  minted none) falls back to the paste's stamped name rather than to an empty
 *  chip. */
export function attachDroppedFiles(files: readonly File[]): boolean {
  const now = new Date();
  const candidates = files.map((file) => ({
    file,
    name: file.name === "" ? pastedAttachmentName(file.type, now) : file.name,
  }));
  if (candidates.length === 0) return false;
  runAction("orchestrator attach", take(candidates));
  return true;
}
