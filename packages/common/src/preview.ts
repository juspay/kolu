/** File-extension classification for the Code browser's preview pipeline.
 *  Node-free and dependency-free so the node server AND the browser client
 *  import the *same* source.
 *
 *  Four disjoint sets partition the binary-previewable space:
 *    - SANDBOX — rendered in an `allow-scripts`, opaque-origin iframe.
 *      `.html`/`.htm`/`.svg` can carry scripts. The set is the security
 *      boundary and changes rarely.
 *    - PDF — rendered in the browser's native PDF viewer. Kept out of the
 *      sandbox branch because Chromium's PDF viewer does not instantiate inside
 *      Kolu's opaque-origin HTML/SVG sandbox.
 *    - RASTER — rendered with a plain `<img>` (image bytes can't execute).
 *    - VIDEO — rendered with a `<video controls>` element (the file route
 *      serves it with a real `video/*` Content-Type and HTTP range support
 *      so the player can seek).
 *
 *  `BINARY_PREVIEWABLE_EXTENSIONS` is their union, so a new previewable
 *  format cannot be added without being placed in exactly one category.
 *
 *  Markdown is a *separate* axis: it stays `kind:"text"` on the wire (there's
 *  no server URL — the client renders it from `content`), so `isMarkdown`
 *  isn't part of the binary partition. */
import { UPLOAD_VIDEO_EXTENSIONS } from "@kolu/padi-client/upload";

export const SANDBOX_PREVIEWABLE_EXTENSIONS = [
  ".html",
  ".htm",
  ".svg",
] as const;

export const PDF_PREVIEWABLE_EXTENSIONS = [".pdf"] as const;

export const RASTER_IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
] as const;

/** Video containers the `<video>` element can play across the browsers Kolu
 *  targets. `.mov` is QuickTime but ships H.264/AAC in practice, which Chrome
 *  and Safari play; non-web codecs (`.mkv`, `.avi`) are deliberately absent —
 *  they'd serve as a binary URL the player can't decode.
 *
 *  DERIVED from padi's canonical `UPLOAD_VIDEO_EXTENSIONS` by prepending the
 *  leading dot this module's `hasExtension` path checks use — so the *droppable*
 *  set and the *playable* set ARE one list and cannot drift. */
export const VIDEO_EXTENSIONS: readonly string[] = UPLOAD_VIDEO_EXTENSIONS.map(
  (ext) => `.${ext}`,
);

export const BINARY_PREVIEWABLE_EXTENSIONS = [
  ...SANDBOX_PREVIEWABLE_EXTENSIONS,
  ...PDF_PREVIEWABLE_EXTENSIONS,
  ...RASTER_IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
] as const;

export type BinaryPreviewFamily = "sandbox" | "pdf" | "raster" | "video";

/** Text files the Code browser can render as a document (`kind:"text"` on the
 *  wire; client renders via `@kolu/solid-markdown`). Includes `.mdx`: Markdown
 *  + JSX — same Markdown preview as `.md`; component tags are not executed and
 *  are stripped by the sanitizer (no separate MDX runtime). */
export const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdx"] as const;

function hasExtension(filePath: string, exts: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/** Client/server: which binary-renderer family owns this path? */
export function binaryPreviewFamily(
  filePath: string,
): BinaryPreviewFamily | null {
  if (hasExtension(filePath, SANDBOX_PREVIEWABLE_EXTENSIONS)) return "sandbox";
  if (hasExtension(filePath, PDF_PREVIEWABLE_EXTENSIONS)) return "pdf";
  if (hasExtension(filePath, RASTER_IMAGE_EXTENSIONS)) return "raster";
  if (hasExtension(filePath, VIDEO_EXTENSIONS)) return "video";
  return null;
}

/** Server: should this file bypass the UTF-8 text read and instead be served
 *  by the file route as `kind: "binary"`? */
export function isBinaryPreviewable(filePath: string): boolean {
  return binaryPreviewFamily(filePath) !== null;
}

/** Client: of the binary-previewable files, render this one with a plain
 *  `<img>` rather than the sandboxed iframe? */
export function isRasterImage(filePath: string): boolean {
  return hasExtension(filePath, RASTER_IMAGE_EXTENSIONS);
}

/** Client: of the binary-previewable files, render this one with a
 *  `<video controls>` element rather than an `<img>` or the iframe? */
export function isVideo(filePath: string): boolean {
  return hasExtension(filePath, VIDEO_EXTENSIONS);
}

/** Client: of the binary-previewable files, render this one in the sandboxed
 *  iframe (`.html`/`.htm`/`.svg`) rather than an `<img>`, `<video>`, or PDF viewer? */
export function isSandboxPreviewable(filePath: string): boolean {
  return hasExtension(filePath, SANDBOX_PREVIEWABLE_EXTENSIONS);
}

/** Client: does this text file have a rendered Markdown form, so the Code
 *  browser offers a Source ⇄ Rendered toggle (defaulting to rendered)? */
export function isMarkdown(filePath: string): boolean {
  return hasExtension(filePath, MARKDOWN_EXTENSIONS);
}

/** Per-segment codec for the repo-relative path embedded in the iframe-preview
 *  URL (`/api/terminals/{host}/{id}/file/{encoded/path}`). Both sides of the wire
 *  must agree: the CLIENT builds the URL and also inverts it, and the HTTP route
 *  decodes the same encoding to stream the bytes.
 *
 *  Slashes stay literal (segment boundaries); each segment is percent-encoded
 *  so a name with spaces or reserved characters survives the URL round-trip. */
export function encodePreviewPath(repoRelPath: string): string {
  return repoRelPath.split("/").map(encodeURIComponent).join("/");
}

/** Invert `encodePreviewPath`. Throws on a malformed percent-sequence (the
 *  caller decides whether that means "ignore" or "error"). */
export function decodePreviewPath(encoded: string): string {
  return encoded.split("/").map(decodeURIComponent).join("/");
}

/** Kolu's preview-URL codec — the `{ encode, decode }` pairing the inversion
 *  in `@kolu/solid-browser` (`pathFromPreviewPathname`) injects. Typed structurally
 *  (not against `@kolu/solid-browser`'s `PreviewPathCodec`, which would invert
 *  the dependency) — the shape is the wire contract both sides agree on. */
export const previewPathCodec: {
  encode: (path: string) => string;
  decode: (encoded: string) => string;
} = { encode: encodePreviewPath, decode: decodePreviewPath };

/** Base of the per-terminal file route + its `file` segment. Shared so the
 *  HTTP route registration, the client's URL builder, and the client (which
 *  resolves repo-relative Markdown image srcs) all agree on one shape —
 *  `${BASE}/{host}/{terminalId}/${FILE}/{encoded/path}`. The leading `{host}`
 *  segment names WHICH padi in the pool owns the terminal, so a tab viewing a
 *  remote host reads that host's bytes (not the local default's). */
export const TERMINAL_FILE_ROUTE_BASE = "/api/terminals";
export const TERMINAL_FILE_ROUTE_FILE_SEGMENT = "file";

/** Build the per-terminal file-route URL for a repo-relative path (no cache
 *  key). `host` is the pool key of the padi that owns the terminal (the tab's
 *  active host) — it rides as a leading path segment so the HTTP route resolves
 *  the bytes against the RIGHT host. The client appends `?v=<tag>` (from
 *  `fs.filePreviewTag`) for the iframe surface — a CONTENT hash, not the mtime,
 *  so an identical-content rewrite doesn't reload the preview. */
export function buildTerminalFileUrl(
  host: string,
  terminalId: string,
  repoRelPath: string,
): string {
  return `${TERMINAL_FILE_ROUTE_BASE}/${encodeURIComponent(host)}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/${encodePreviewPath(repoRelPath)}`;
}
