/** Kolu's binding for sandboxed-preview link interception: the host-agnostic
 *  inversion lives in `@kolu/solid-browser`'s `pathFromPreviewPathname`; this
 *  binds it to kolu's preview-URL codec (`kolu-common/preview`), the same
 *  `encodePreviewPath`/`decodePreviewPath` the server's `buildIframePreviewUrl`
 *  uses — so the inversion can't drift from the encoding.
 *
 *  The browse preview iframe is served at
 *  `/api/terminals/{id}/file/{encoded/path}?v=<mtime>`; the in-iframe
 *  artifact-sdk reports its own `location.pathname` when a same-frame link
 *  click loads a new file (the opaque-origin sandbox blocks the parent from
 *  reading `contentWindow.location`). Returns null when the iframe navigated
 *  outside the file route — the caller leaves the tree selection untouched. */

import { pathFromPreviewPathname } from "@kolu/solid-browser";
import { decodePreviewPath, encodePreviewPath } from "kolu-common/preview";

export function repoPathFromPreviewPathname(
  reportedPathname: string,
  currentUrl: string,
  currentPath: string,
): string | null {
  return pathFromPreviewPathname(reportedPathname, currentUrl, currentPath, {
    encode: encodePreviewPath,
    decode: decodePreviewPath,
  });
}
