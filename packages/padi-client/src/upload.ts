import { formatBytes, MIB } from "@kolu/byte-units";

/** Hard cap on a single dropped file — a POLICY cap on the file, deliberately
 *  larger than any one wire frame: the upload is chunked
 *  (`FRAME_CHUNK_BYTES`), so the file size and the frame size are independent
 *  numbers. */
export const MAX_UPLOAD_BYTES = 50 * MIB;

/** The video containers a dropped file may carry, in extension form (no leading
 *  dot) — the canonical set the app's playable `VIDEO_EXTENSIONS` derives
 *  from. */
export const UPLOAD_VIDEO_EXTENSIONS: readonly string[] = [
  "mp4",
  "m4v",
  "webm",
  "mov",
  "ogv",
];

const TEXT_AND_DOC_EXTENSIONS: readonly string[] = ["txt", "md", "rst", "pdf"];

const STRUCTURED_DATA_EXTENSIONS: readonly string[] = [
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
];

const WEB_EXTENSIONS: readonly string[] = ["html", "htm", "css"];

const CODE_EXTENSIONS: readonly string[] = [
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
];

const IMAGE_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
];

/** Lowercase file extensions (without leading dot) that may be dropped. The
 *  {@link MAX_UPLOAD_BYTES} cap applies to every one of them. */
export const ALLOWED_UPLOAD_EXTENSIONS: readonly string[] = [
  ...TEXT_AND_DOC_EXTENSIONS,
  ...STRUCTURED_DATA_EXTENSIONS,
  ...WEB_EXTENSIONS,
  ...CODE_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
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
    return `File too large: "${label}" exceeds the ${formatBytes(MAX_UPLOAD_BYTES)} limit`;
  }
  return null;
}
