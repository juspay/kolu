/** Which server-served previewable files the Code browser presents with a
 *  plain `<img>` (centered on a checkerboard) instead of the sandboxed
 *  iframe. This is a *presentation* split below the `fsReadFile` wire
 *  boundary — the server still classifies all of these as `kind: "binary"`
 *  via `IFRAME_PREVIEWABLE_EXTENSIONS` (see
 *  `packages/server/src/iframePreviewRoute.ts`); the client just picks the
 *  renderer. `.svg` is deliberately excluded: it can carry scripts, so it
 *  stays in the `allow-scripts`-only iframe sandbox. */
const RASTER_IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
];

export function isRasterImage(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return RASTER_IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
