/** The pictures THIS BROWSER is holding — the thumbnails no wire carries.
 *
 *  An attachment's bytes go up to padi the moment it is attached and come back
 *  as a path; nothing on the wire carries a `data:` URL, because a prompt frame
 *  that grows with the file is the 1009 socket close the terminal's paste
 *  already paid for once (`terminal/pasteDelivery.ts` is the write-up). So the
 *  only picture a chip can draw is one this tab read itself, and this is where
 *  it is kept: attachment id → the `data:` URL its `FileReader` produced.
 *
 *  A row restored after a reload — or read in a second browser — finds nothing
 *  here and draws the name+size chip. That is the documented face of an image
 *  this browser does not hold, and a far better one than a broken-image glyph.
 *
 *  BOUNDED on purpose. A session that pastes screenshots all afternoon would
 *  otherwise hold every one of them as base64 forever, which is tens of
 *  megabytes of string nobody is looking at. Past {@link THUMBNAIL_MEMORY} the
 *  OLDEST is dropped — the pictures worth keeping are the ones near the bottom
 *  of the transcript — and the chip it belonged to falls back to the same
 *  name+size face a restored row already wears, so the eviction costs a
 *  thumbnail and never tells a lie. */

import { isImageAttachment } from "./attachments";

/** How many pictures this tab keeps. Twelve or so screenshots is more
 *  scrollback than anyone revisits, and the fallback is honest. */
const THUMBNAIL_MEMORY = 32;

/** Insertion-ordered by `Map`'s own contract, which is what makes "the oldest"
 *  a fact rather than a guess. */
const held = new Map<string, string>();

/** Keep the picture for an attachment this tab just read.
 *
 *  The `image/*` test lives HERE rather than at the call site so there is one
 *  rule about what a thumbnail is: a PDF's `data:` URL would be megabytes of
 *  string no chip can draw, and holding it would spend the memory budget on
 *  something that never becomes a picture. */
export function rememberThumbnail(
  attachment: { readonly id: string; readonly mimeType: string },
  dataUrl: string,
): void {
  if (!isImageAttachment(attachment)) return;
  held.set(attachment.id, dataUrl);
  while (held.size > THUMBNAIL_MEMORY) {
    const oldest = held.keys().next();
    if (oldest.done === true) return;
    held.delete(oldest.value);
  }
}

/** The attachment never became a row — a chip removed before the send, an
 *  upload that failed. Nothing will ever draw it, so it must not hold its
 *  bytes until the tab closes. */
export function forgetThumbnail(id: string): void {
  held.delete(id);
}

/** The picture a chip draws, or nothing. Both the composer's chips and the
 *  transcript's draw from here, so the two cannot disagree about when a
 *  thumbnail exists. */
export function thumbnailOf(attachment: {
  readonly id: string;
}): string | undefined {
  return held.get(attachment.id);
}
