import { isImageAttachment } from "./attachments";

const THUMBNAIL_MEMORY = 32;

const held = new Map<string, string>();

function evictOldest(): void {
  while (held.size > THUMBNAIL_MEMORY) {
    const oldest = held.keys().next();
    if (oldest.done === true) return;
    held.delete(oldest.value);
  }
}

export function rememberThumbnail(
  attachment: { readonly id: string; readonly mimeType: string },
  dataUrl: string,
): void {
  if (!isImageAttachment(attachment)) return;
  held.set(attachment.id, dataUrl);
  evictOldest();
}

export function forgetThumbnail(id: string): void {
  held.delete(id);
}

export function thumbnailOf(attachment: {
  readonly id: string;
}): string | undefined {
  return held.get(attachment.id);
}
