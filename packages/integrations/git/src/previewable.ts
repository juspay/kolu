/** File-extension classification that drives the `fsReadFile` wire `kind`
 *  and, for binary files, how the Code browser presents them. Lives here in
 *  kolu-git next to `FsReadFileOutputSchema` (the wire contract these feed)
 *  and is deliberately node-free so the node server AND the browser client
 *  import the *same* source. The previous arrangement — a server extension
 *  list plus a separate client list kept in step by a prose comment — could
 *  silently drift: an image format added on one side only rendered as
 *  garbage (server forgot it) or a broken `<img>` (client forgot it).
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
 *  not a convention a future edit can quietly break. */

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
