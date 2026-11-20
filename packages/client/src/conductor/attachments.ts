import {
  ATTACHMENT_BYTE_CAP,
  attachmentTooBig,
  PROMPT_ATTACHMENT_BYTE_CAP,
  promptAttachmentsTooBig,
} from "kolu-common/conductor";

export function isImageAttachment(attachment: {
  readonly mimeType: string;
}): boolean {
  return attachment.mimeType.startsWith("image/");
}

export interface ClipboardEntry {
  readonly kind: string;
  readonly type: string;
}

export function pastedAttachments<T extends ClipboardEntry>(
  entries: readonly T[],
): T[] {
  return entries.filter((entry) => entry.kind === "file");
}

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

function extensionOfMime(mimeType: string): string {
  const subtype = mimeType.split("/")[1];
  if (subtype === undefined || subtype === "") return "bin";
  return subtype.split("+")[0] ?? "bin";
}

export function pastedAttachmentName(mimeType: string, at: Date): string {
  const stamp = [at.getHours(), at.getMinutes(), at.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  return `pasted-${stamp}.${extensionOfMime(mimeType)}`;
}

/** An id unique within this browser's run — which is all the contract asks for
 *  ("stable within the prompt that carried it"), since kolu-server re-keys nothing and
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

export function mimeTypeOf(file: File): string {
  return file.type === "" ? "application/octet-stream" : file.type;
}

export interface ReadFile {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly dataUrl: string;
  readonly base64: string;
}

export function readForUpload(
  file: File,
  name: string,
  id: string,
): Promise<ReadFile> {
  const { promise, resolve, reject } = Promise.withResolvers<ReadFile>();
  const reader = new FileReader();
  reader.onerror = () =>
    reject(reader.error ?? new Error(`could not read "${name}"`));
  reader.onload = () => {
    const dataUrl = reader.result;
    if (typeof dataUrl !== "string") {
      reject(new Error(`"${name}" did not read as a data URL`));
      return;
    }
    const mark = dataUrl.indexOf(",");
    if (!dataUrl.startsWith("data:") || mark === -1) {
      reject(new Error(`"${name}" did not read as a base64 data URL`));
      return;
    }
    resolve({
      id,
      name,
      mimeType: mimeTypeOf(file),
      bytes: file.size,
      dataUrl,
      base64: dataUrl.slice(mark + 1),
    });
  };
  reader.readAsDataURL(file);
  return promise;
}
