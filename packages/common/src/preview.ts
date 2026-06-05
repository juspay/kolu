/** File-extension classification for the Code browser's preview pipeline.
 *  Node-free and dependency-free so the node server AND the browser client
 *  import the *same* source — the seam that historically drifted when a
 *  server list and a client list were kept in step only by a prose comment
 *  (an image format added on one side rendered as garbage on the other).
 *
 *  Lives in kolu-common, not kolu-git: classification is a preview concern
 *  shared across client and server, not a git operation. It feeds two
 *  decisions:
 *    - SERVER: `isBinaryPreviewable` picks the `FsReadFileOutput.kind` wire
 *      variant (inline text vs a route-served URL) — the schema lives in
 *      `kolu-git/schemas.ts`.
 *    - CLIENT: `isRasterImage` / `isMarkdown` pick the rendered appliance in
 *      `@kolu/solid-fileview` — a plain `<img>`, a sandboxed iframe, or a
 *      rendered Markdown document.
 *
 *  Two disjoint sets partition the binary-previewable space:
 *    - SANDBOX — rendered in an `allow-scripts`, opaque-origin iframe.
 *      `.html`/`.htm`/`.svg` can carry scripts; `.pdf` rides the same
 *      sandbox. The set is the security boundary and changes rarely.
 *    - RASTER — rendered with a plain `<img>` (image bytes can't execute).
 *      This is the volatile axis (new formats: avif, jxl, …).
 *
 *  `BINARY_PREVIEWABLE_EXTENSIONS` is their union, so a new previewable
 *  format cannot be added without being placed in exactly one category —
 *  the "every non-document binary is an image" assumption is structural,
 *  not a convention a future edit can quietly break.
 *
 *  Markdown is a *separate* axis: it stays `kind:"text"` on the wire (there's
 *  no server URL — the client renders it from `content`), so `isMarkdown`
 *  isn't part of the binary partition. It tells the client a text file also
 *  has a rendered form, which is what lights the Source ⇄ Rendered toggle. */

export const SANDBOX_PREVIEWABLE_EXTENSIONS = [
  ".html",
  ".htm",
  ".svg",
  ".pdf",
] as const;

export const RASTER_IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
] as const;

export const BINARY_PREVIEWABLE_EXTENSIONS = [
  ...SANDBOX_PREVIEWABLE_EXTENSIONS,
  ...RASTER_IMAGE_EXTENSIONS,
] as const;

/** Text files the Code browser can render as a document. Stays
 *  `kind:"text"` on the wire — there's no server URL; the client renders it
 *  from `content` via `@kolu/solid-markdown`. */
export const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;

function hasExtension(filePath: string, exts: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
}

/** Server: should this file bypass the UTF-8 text read and instead be served
 *  by the file route as `kind: "binary"`? */
export function isBinaryPreviewable(filePath: string): boolean {
  return hasExtension(filePath, BINARY_PREVIEWABLE_EXTENSIONS);
}

/** Client: of the binary-previewable files, render this one with a plain
 *  `<img>` rather than the sandboxed iframe? */
export function isRasterImage(filePath: string): boolean {
  return hasExtension(filePath, RASTER_IMAGE_EXTENSIONS);
}

/** Client: does this text file have a rendered Markdown form, so the Code
 *  browser offers a Source ⇄ Rendered toggle (defaulting to rendered)? */
export function isMarkdown(filePath: string): boolean {
  return hasExtension(filePath, MARKDOWN_EXTENSIONS);
}

/** Per-segment codec for the repo-relative path embedded in the iframe-preview
 *  URL (`/api/terminals/{id}/file/{encoded/path}`). Same kolu-common rationale
 *  as the classifiers above: both sides of the wire must agree. The SERVER
 *  builds the URL (`buildIframePreviewUrl` in `iframePreviewRoute.ts`) and the
 *  CLIENT inverts it (`@kolu/solid-browser`'s `pathFromPreviewPathname`, with
 *  this codec bound in `right-panel/BrowseIframeRenderer.tsx`, to follow
 *  in-iframe link navigation) — a single source keeps the encode/decode from
 *  drifting, so links into subdirectories or paths with spaces resolve to the
 *  right file.
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

/** Base of the per-terminal file route + its `file` segment. Shared so the
 *  server route registration, the server URL builder, and the client (which
 *  resolves repo-relative Markdown image srcs) all agree on one shape —
 *  `${BASE}/{terminalId}/${FILE}/{encoded/path}`. */
export const TERMINAL_FILE_ROUTE_BASE = "/api/terminals";
export const TERMINAL_FILE_ROUTE_FILE_SEGMENT = "file";

/** Build the per-terminal file-route URL for a repo-relative path (no cache
 *  key). The server's `buildIframePreviewUrl` appends `?v=<mtime>` for the
 *  iframe surface; the client uses the bare URL to point a rendered-Markdown
 *  image at the actual repo file it references. */
export function buildTerminalFileUrl(
  terminalId: string,
  repoRelPath: string,
): string {
  return `${TERMINAL_FILE_ROUTE_BASE}/${terminalId}/${TERMINAL_FILE_ROUTE_FILE_SEGMENT}/${encodePreviewPath(repoRelPath)}`;
}
