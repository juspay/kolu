/** What rides along with a prompt — an image pasted into the box, a file
 *  dropped on the pane — and the rules that decide whether it may.
 *
 *  Policy only: no store, no toast, no DOM beyond the `FileReader` that turns a
 *  `File` into the `data:` URL the wire carries. The decisions a person can
 *  trip over — which clipboard entries are attachments at all, and whether one
 *  more would blow the cap — are plain functions over plain values, so they are
 *  tested without a composer around them.
 *
 *  The caps are enforced at BOTH ends on purpose. padi is the authority and
 *  refuses with a sentence; this end refuses with the same arithmetic at the
 *  moment of the paste, because a person who has waited for a 40 MiB image to
 *  encode and travel before being told no has already lost the thing the cap
 *  was meant to save them. */

import {
  ATTACHMENT_BYTE_CAP,
  attachmentTooBig,
  type OrchestratorAttachment,
  PROMPT_ATTACHMENT_BYTE_CAP,
  promptAttachmentsTooBig,
} from "@kolu/padi-client/orchestrator";

/** Does this attachment draw as a picture? The same `image/*` test padi uses to
 *  pick the ACP `image` content block, so the chip and the block agree about
 *  what an image is. */
export function isImageAttachment(attachment: {
  readonly mimeType: string;
}): boolean {
  return attachment.mimeType.startsWith("image/");
}

/** The picture a chip draws, or nothing.
 *
 *  Nothing is the NORMAL case for a row restored after a padi restart: the
 *  base64 is never persisted (padi keeps the bytes under its state root and
 *  the row keeps a path), so a chip with a name and a size is the honest face
 *  of an image this browser no longer holds — and a far better one than a
 *  broken-image glyph. Both the composer's chips and the transcript's draw
 *  from here, so the two cannot disagree about when a thumbnail exists. */
export function thumbnailOf(attachment: {
  readonly mimeType: string;
  readonly dataUrl: string | null;
}): string | undefined {
  return isImageAttachment(attachment) && attachment.dataUrl !== null
    ? attachment.dataUrl
    : undefined;
}

/** A clipboard entry as the paste rule sees it — the two fields of
 *  `DataTransferItem` the decision turns on, so the rule can be exercised
 *  without synthesising a real clipboard. */
export interface ClipboardEntry {
  readonly kind: string;
  readonly type: string;
}

/** Which entries of a paste become attachments: the FILES, whatever they hold.
 *
 *  An `image/*` file is the screenshot somebody just took; a non-image file is
 *  a file they copied in a file manager. Both are attachments. Everything else
 *  on the clipboard is a string, and a string pasted into a textarea is text —
 *  it belongs to the box, not to this rule.
 *
 *  Generic in the entry so the caller keeps its own `DataTransferItem`s and
 *  calls `getAsFile()` on the ones that came back, rather than this module
 *  touching the clipboard API. A non-empty result means the paste was ABOUT the
 *  files, so the caller takes the event over; an empty one leaves the paste to
 *  the textarea. */
export function pastedAttachments<T extends ClipboardEntry>(
  entries: readonly T[],
): T[] {
  return entries.filter((entry) => entry.kind === "file");
}

/** Why this file may not be attached, or `null` if it may.
 *
 *  Two refusals, because they are two different problems: one file too big is
 *  a file to shrink, a message too heavy is an attachment to drop. Neither
 *  sentence is written here — both come from the wire contract padi refuses
 *  with, so the pre-flight refusal and the server's are the same words rather
 *  than two rules a person has to reconcile. */
export function attachmentRefusal(
  candidate: { readonly name: string; readonly bytes: number },
  attachedBytes: number,
): string | null {
  if (candidate.bytes > ATTACHMENT_BYTE_CAP) {
    return attachmentTooBig(candidate.name, candidate.bytes);
  }
  const total = attachedBytes + candidate.bytes;
  if (total > PROMPT_ATTACHMENT_BYTE_CAP) return promptAttachmentsTooBig(total);
  return null;
}

/** The extension a MIME type implies: the subtype, less any `+suffix`
 *  structure (`image/svg+xml` → `svg`). Derived rather than looked up in a
 *  table, because the only thing this name has to do is be recognisable in a
 *  chip and keep its kind legible to whoever opens the file padi wrote. */
function extensionOfMime(mimeType: string): string {
  const subtype = mimeType.split("/")[1];
  if (subtype === undefined || subtype === "") return "bin";
  return subtype.split("+")[0] ?? "bin";
}

/** A name for something PASTED. The browser calls every pasted screenshot
 *  `image.png`, so three of them in one message are three chips with one name
 *  and no way to tell which is which; the stamp is what makes them distinct in
 *  the chip, in the transcript, and in padi's state directory. */
export function pastedAttachmentName(mimeType: string, at: Date): string {
  const stamp = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  return `pasted-${stamp}.${extensionOfMime(mimeType)}`;
}

/** An id unique within this browser's run — which is all the contract asks for
 *  ("stable within the prompt that carried it"), since padi re-keys nothing and
 *  the row is drawn against the prompt it travelled with.
 *
 *  Deliberately NOT `crypto.randomUUID`: that is a secure-context API, and kolu
 *  is genuinely reached over plain `http://` at a LAN address or a Tailscale
 *  IP, where it is `undefined` and reading it throws. */
let minted = 0;
export function mintAttachmentId(): string {
  minted += 1;
  return `att-${Date.now().toString(36)}-${minted}`;
}

/** Read a file into the shape the wire takes.
 *
 *  `readAsDataURL` rather than a hand-rolled base64 of an `ArrayBuffer`: the
 *  `data:` URL is what both consumers want — the chip puts it straight in an
 *  `<img src>`, and padi splits the base64 off it for the ACP `image` block —
 *  so encoding it twice in two places is the thing to avoid.
 *
 *  A file the OS could not type (`file.type === ""`, common for extensionless
 *  files) is `application/octet-stream`: that IS the type of unknown bytes, and
 *  it routes the attachment to a `resource_link` at padi, which is the right
 *  answer for something nobody can claim is text. */
export function readAttachment(
  file: File,
  name: string,
): Promise<OrchestratorAttachment> {
  const { promise, resolve, reject } =
    Promise.withResolvers<OrchestratorAttachment>();
  const reader = new FileReader();
  reader.onerror = () =>
    reject(reader.error ?? new Error(`could not read "${name}"`));
  reader.onload = () => {
    const dataUrl = reader.result;
    if (typeof dataUrl !== "string") {
      reject(new Error(`"${name}" did not read as a data URL`));
      return;
    }
    resolve({
      id: mintAttachmentId(),
      name,
      mimeType: file.type === "" ? "application/octet-stream" : file.type,
      bytes: file.size,
      dataUrl,
      path: null,
    });
  };
  reader.readAsDataURL(file);
  return promise;
}
