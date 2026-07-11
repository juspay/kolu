/**
 * Shared policy for file drops onto a terminal. Both the client (pre-flight
 * gate before encoding/sending) and the server (authoritative gate before
 * writing to disk) consume these constants — keeping them in one place
 * means the two sides cannot drift on the rejection threshold.
 */

/** Hard cap on a single dropped file. This leaves room for a useful bug-repro
 *  video while bounding the current whole-file, base64-encoded RPC upload. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** The video containers a dropped file may carry — padi's OWN list, in extension
 *  form (no leading dot). The CANONICAL source (L17): padi owns the upload/file
 *  domain, so this is the one home for the playable-container set. The app's
 *  `kolu-common/preview` `VIDEO_EXTENSIONS` (the formats the Code browser plays
 *  back) is DERIVED from this by prepending a dot — the app→padi arrow the seal
 *  sanctions — so the droppable set and the playable set can't drift. The former
 *  hand-kept copy + drift-guard test are gone; the type system carries what the
 *  test policed. */
export const UPLOAD_VIDEO_EXTENSIONS: readonly string[] = [
  "mp4",
  "m4v",
  "webm",
  "mov",
  "ogv",
];

/** Lowercase file extensions (without leading dot) that may be dropped.
 *  Curated to text, code, structured data, common docs, images, and video.
 *  The video entries are the canonical `UPLOAD_VIDEO_EXTENSIONS` above (padi owns
 *  the container set; preview.ts derives its playable list from it); the
 *  image/doc/code entries are listed inline here. New entries land here, not at
 *  the call sites. */
export const ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  // Text & docs
  "txt",
  "md",
  "rst",
  "pdf",
  // Structured data
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "xml",
  "csv",
  "tsv",
  "log",
  "ini",
  "env",
  "lock",
  // Web
  "html",
  "htm",
  "css",
  // Code
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "swift",
  "sh",
  "bash",
  "zsh",
  "fish",
  "sql",
  "nix",
  "hs",
  "elm",
  "lua",
  "vim",
  // Images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  // Video — the containers Kolu can play back in the Code browser (padi's own
  // canonical `UPLOAD_VIDEO_EXTENSIONS`; the app's preview list derives from it,
  // so they can't drift). The 50 MB cap above still applies — video is allowed,
  // not exempted.
  ...UPLOAD_VIDEO_EXTENSIONS,
];

/** Return the lowercase extension (no dot) of `name`, or `null` if there
 *  isn't one. `.DS_Store` → `ds_store`; `Cargo.lock` → `lock`; `README` →
 *  `null`. */
export function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

/** Whether a dropped filename is permitted by the extension allowlist. */
export function isAllowedUploadName(name: string): boolean {
  const ext = extensionOf(name);
  return ext !== null && ALLOWED_UPLOAD_EXTENSIONS.includes(ext);
}

/** Decoded byte length of a base64 string — `(len * 3/4)` minus padding.
 *  Lets the upload gate (`rejectionFor`) size-check without materializing the
 *  Buffer (the same helper the retired server `uploadFile`/`pasteImage` handlers
 *  used). Lives here beside the gate its only caller feeds. */
export function base64DecodedLength(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/** Human-readable rejection reason for a dropped file, or `null` if it
 *  passes. Shared so the client toast and the server `ORPCError` message
 *  match verbatim. */
export function rejectionFor(name: string, bytes: number): string | null {
  if (!isAllowedUploadName(name)) {
    return `File type not allowed: "${name}". Allowed extensions: ${ALLOWED_UPLOAD_EXTENSIONS.join(", ")}`;
  }
  return sizeRejectionFor(name, bytes);
}

/** Size-only rejection — for upload surfaces that have no filename to
 *  validate (clipboard image paste). Same wording as the full
 *  `rejectionFor` size branch so the message is consistent. */
export function sizeRejectionFor(label: string, bytes: number): string | null {
  if (bytes > MAX_UPLOAD_BYTES) {
    const mb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
    return `File too large: "${label}" exceeds the ${mb} MB limit`;
  }
  return null;
}
