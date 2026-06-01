/** Per-segment codec for repo-relative paths embedded in the iframe-preview
 *  URL (`/api/terminals/{id}/file/{encoded/path}`). Lives here in kolu-git,
 *  node-free, for the same reason `previewable.ts` does: the encoding is used
 *  on BOTH sides of the wire — the server builds the URL (`buildIframePreviewUrl`
 *  in `packages/server/src/iframePreviewRoute.ts`) and the browser client
 *  inverts it (`repoPathFromPreviewPathname` in
 *  `packages/client/src/right-panel/iframePreviewNav.ts`, to follow in-iframe
 *  link navigation). A single source keeps the two from silently drifting —
 *  if the encode/decode pair disagreed, links into subdirectories or paths
 *  with spaces would resolve to the wrong file.
 *
 *  Slashes stay literal (segment boundaries); each segment is percent-encoded
 *  so a name with spaces or reserved characters survives the URL round-trip. */

/** Encode a repo-relative path for the preview URL's path tail. */
export function encodePreviewPath(repoRelPath: string): string {
  return repoRelPath.split("/").map(encodeURIComponent).join("/");
}

/** Invert `encodePreviewPath`. Throws on a malformed percent-sequence (the
 *  caller decides whether that means "ignore" or "error"). */
export function decodePreviewPath(encoded: string): string {
  return encoded.split("/").map(decodeURIComponent).join("/");
}
