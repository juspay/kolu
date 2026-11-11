/** Taking files INTO the composer's draft — the one path a paste and a drop
 *  both run through.
 *
 *  Three modules, three jobs: `attachments.ts` decides and encodes, `drafts.ts`
 *  holds what is not yet sent, and this is the seam between them — the only
 *  place that says no out loud. A refused file is a toast with the sentence the
 *  policy wrote, never a silent drop: a chip that simply failed to appear is
 *  indistinguishable from a paste the browser never delivered. */

import { toast } from "solid-sonner";
import {
  attachmentRefusal,
  pastedAttachmentName,
  pastedAttachments,
  readAttachment,
} from "./attachments";
import { addComposerAttachment, composerAttachmentBytes } from "./drafts";

/** A file on its way in, under the name it will wear. */
interface Candidate {
  readonly file: File;
  readonly name: string;
}

/** Admit what fits, one at a time.
 *
 *  SEQUENTIAL on purpose. The per-message cap is measured against what the
 *  draft already holds, so reading three files in parallel and judging all
 *  three against the draft as it was before any of them landed is how twelve
 *  megabytes of screenshots get in under a twenty-megabyte cap. Awaiting each
 *  read before judging the next makes the arithmetic the obvious one. */
async function take(candidates: readonly Candidate[]): Promise<void> {
  for (const candidate of candidates) {
    const why = attachmentRefusal(
      { name: candidate.name, bytes: candidate.file.size },
      composerAttachmentBytes(),
    );
    if (why !== null) {
      toast.error(why);
      continue;
    }
    try {
      addComposerAttachment(
        await readAttachment(candidate.file, candidate.name),
      );
    } catch (err) {
      toast.error(
        `Could not attach "${candidate.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
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
  void take(candidates);
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
  void take(candidates);
  return true;
}
