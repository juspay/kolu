/** Map an in-iframe-reported `location.pathname` back to the repo-relative
 *  path it previews. The browse preview iframe is served from
 *  `buildIframePreviewUrl` (server-side) as
 *  `/api/terminals/{id}/file/{encoded/path}?v=<mtime>`; the in-iframe
 *  artifact-sdk reports its own `location.pathname` when a same-frame link
 *  click loads a new file (the opaque-origin sandbox blocks the parent from
 *  reading `contentWindow.location`).
 *
 *  The route prefix isn't hardcoded here — the client can't import the
 *  server's URL contract — so it's derived from the file currently shown:
 *  `currentUrl` (its `buildIframePreviewUrl` output) ends with the
 *  per-segment-encoded `currentPath`, and everything before that is the
 *  shared `/api/terminals/{id}/file/` prefix. Stripping that prefix off the
 *  reported pathname and per-segment-decoding inverts the builder's
 *  `encodeURIComponent` exactly — no second source of truth for the route.
 *
 *  Returns null when the iframe navigated outside the file route (an external
 *  link, or a prefix mismatch that shouldn't happen) — the caller leaves the
 *  tree selection untouched in that case. */
export function repoPathFromPreviewPathname(
  reportedPathname: string,
  currentUrl: string,
  currentPath: string,
): string | null {
  const currentPathname = currentUrl.split("?")[0] ?? currentUrl;
  const encodedCurrent = currentPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  if (!currentPathname.endsWith(encodedCurrent)) return null;
  const prefix = currentPathname.slice(
    0,
    currentPathname.length - encodedCurrent.length,
  );
  if (!reportedPathname.startsWith(prefix)) return null;
  const encodedNext = reportedPathname.slice(prefix.length);
  if (encodedNext === "") return null;
  try {
    return encodedNext.split("/").map(decodeURIComponent).join("/");
  } catch {
    // A malformed percent-sequence can only arrive if the previewed page
    // crafted a bogus `ready` pathname — treat it as "no navigation".
    return null;
  }
}
