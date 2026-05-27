/**
 * Shared policy for file drops onto a terminal. Both the client (pre-flight
 * gate before encoding/sending) and the server (authoritative gate before
 * writing to disk) consume these constants — keeping them in one place
 * means the two sides cannot drift on the rejection threshold.
 */

/** Hard cap on a single dropped file. Agents don't need huge binaries;
 *  the goal is "paste me a snippet/log/screenshot", not "ship me a tarball". */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Lowercase file extensions (without leading dot) that may be dropped.
 *  Curated to text, code, structured data, common docs, and images. New
 *  entries land here, not at the call sites. */
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
] as const;

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
    const mb = (MAX_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
    return `File too large: "${label}" exceeds the ${mb} MB limit`;
  }
  return null;
}
