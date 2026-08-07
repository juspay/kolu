/**
 * Shared policy for file drops onto a terminal. Both the client (pre-flight
 * gate before encoding/sending) and the server (authoritative gate before
 * writing to disk) consume these constants — keeping them in one place
 * means the two sides cannot drift on the rejection threshold.
 */

/** Hard cap on a single dropped file. This leaves room for a useful bug-repro
 *  video. It is a POLICY cap on the file, and deliberately larger than any one
 *  wire frame: the upload is chunked (`UPLOAD_CHUNK_BYTES`), so the file size
 *  and the frame size are now independent numbers. Before chunking they were
 *  the same number, and a 26 MB drop killed the tab's socket. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Raw bytes of file content carried by ONE `scratch.write` chunk.
 *
 *  ## Derivation
 *
 *  The budget is `RPC_MAX_FRAME_BYTES` = 16 MiB = 16777216 (`@kolu/surface`'s
 *  `frame-limit`; a frame over it closes the socket with 1009 rather than
 *  failing the call). A chunk must fit with margin AFTER two expansions:
 *
 *  1. **base64** — the wire field is a base64 string, so R raw bytes become
 *     `ceil(R / 3) * 4` characters: a 4/3 (≈1.334x) expansion.
 *  2. **the JSON envelope** — the frame is the whole encoded request, not just
 *     the payload: procedure path, request id, `terminalId`, `appendTo` (an
 *     absolute scratch path), the dropped `name`, and JSON's own quoting. That
 *     is bounded by the low kilobytes; a path and a filename are both bounded
 *     by PATH_MAX-ish lengths, so 64 KiB is a generous ceiling for it.
 *
 *  base64's alphabet (`A-Za-z0-9+/=`) contains no character JSON escapes, so
 *  the payload does NOT expand a third time inside the JSON string — this is
 *  the one expansion it is tempting to forget, and it is genuinely absent.
 *
 *  The size must also be a MULTIPLE OF 3, so that the 3-bytes-to-4-characters
 *  base64 grouping divides it exactly and every chunk boundary lands on a
 *  4-character group (see `UPLOAD_CHUNK_BASE64_CHARS`). A MiB is 1048576, which
 *  is NOT divisible by 3, so a round `4 * 1024 * 1024` fails that requirement —
 *  3 MiB is the nearest size that satisfies it, and it happens to land on a
 *  pleasant identity: 3 MiB of bytes is exactly 4 MiB of base64.
 *
 *  At 3 MiB raw:
 *
 *      base64:   (3145728 / 3) * 4 = 4194304 bytes  (4.00 MiB, exact)
 *      envelope: < 65536 bytes
 *      frame:    < 4259840 bytes  (4.06 MiB)
 *      budget:   16777216 bytes   (16.00 MiB)
 *      headroom: 3.94x
 *
 *  Nearly 4x margin means the number stays correct through a bump that adds
 *  envelope fields, and through a re-derivation that discovers another modest
 *  expansion — while a 50 MB file still costs only 17 round trips. Trading a
 *  handful of round trips for a 4x margin on a socket-killing failure is the
 *  right side of that trade. */
export const UPLOAD_CHUNK_BYTES = 3 * 1024 * 1024;

/** Base64 characters per chunk — `UPLOAD_CHUNK_BYTES` after the 4/3 expansion.
 *
 *  A multiple of 4, which is what makes chunking a base64 STRING sound: every
 *  4-character base64 group decodes to exactly 3 bytes independently of its
 *  neighbours, so splitting on a 4-character boundary and decoding each piece
 *  separately concatenates to the same bytes as decoding the whole. Split off a
 *  4-boundary and the pieces decode to garbage — only the final piece may carry
 *  `=` padding. `UPLOAD_CHUNK_BYTES` is a multiple of 3 (3 MiB = 3145728 =
 *  3 × 1048576), so the division below is exact and its result is a multiple of
 *  4 by construction — which the unit test re-checks rather than assumes. */
export const UPLOAD_CHUNK_BASE64_CHARS = (UPLOAD_CHUNK_BYTES / 3) * 4;

/** Split a base64 string into wire-sized pieces on 4-character boundaries.
 *
 *  Returns at least one piece — an empty input yields `[""]`, so an empty file
 *  still performs exactly one write and still lands on disk. */
export function chunkBase64(
  data: string,
  chunkChars: number = UPLOAD_CHUNK_BASE64_CHARS,
): string[] {
  if (chunkChars % 4 !== 0) {
    throw new Error(
      `base64 chunk size must be a multiple of 4, got ${chunkChars}`,
    );
  }
  if (data.length <= chunkChars) return [data];
  const out: string[] = [];
  for (let i = 0; i < data.length; i += chunkChars) {
    out.push(data.slice(i, i + chunkChars));
  }
  return out;
}

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
