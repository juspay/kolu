/** Sandboxed-preview pathname inversion — pure, framework-free, host-agnostic.
 *
 *  Maps a **preview pathname** reported by a sandboxed iframe (after an in-frame
 *  `<a>` click) back to the document path it shows, by inverting the host's
 *  preview-URL encoding through an injected codec. It knows nothing about git,
 *  repos, or kolu — the codec is the host's contract, and a "document path" is
 *  whatever opaque string the host resolves content from. */

/** The host's preview-URL codec — how it encodes a document path into the path
 *  segment of a sandboxed-preview URL, and back. Injected because the encoding
 *  is the host's contract (kolu's lives in `kolu-common/preview`), not this
 *  package's. `encode`/`decode` must round-trip. */
export type PreviewPathCodec = {
  encode: (path: string) => string;
  decode: (encoded: string) => string;
};

/** Map a sandboxed preview's reported `location.pathname` back to the document
 *  path it shows. The preview is served at `<prefix>/<encode(path)>?v=…`; after
 *  an in-frame link click the frame reports its own `location.pathname` (the
 *  opaque-origin sandbox blocks the parent from reading it directly).
 *
 *  The prefix isn't known here — it's derived from the file currently shown:
 *  `currentUrl` ends with `encode(currentPath)`, and everything before that is
 *  the shared prefix. Using the same injected codec for both directions means
 *  the inversion can't drift from the encoding — no second source of truth.
 *
 *  Returns null when the frame navigated outside the preview route (an external
 *  link, or a prefix mismatch) — the caller leaves selection untouched. */
export function pathFromPreviewPathname(
  reportedPathname: string,
  currentUrl: string,
  currentPath: string,
  codec: PreviewPathCodec,
): string | null {
  // Split on `?` only (no `#`): a preview URL carries at most `?v=<mtime>` and
  // never a fragment — the path's own `?`/`#` are percent-encoded by the codec —
  // so the `#fragment` asymmetry with `resolveLinkHref` is intentional, not an
  // oversight.
  const currentPathname = currentUrl.split("?")[0] ?? currentUrl;
  const encodedCurrent = codec.encode(currentPath);
  if (!currentPathname.endsWith(encodedCurrent)) return null;
  const prefix = currentPathname.slice(
    0,
    currentPathname.length - encodedCurrent.length,
  );
  if (!reportedPathname.startsWith(prefix)) return null;
  const encodedNext = reportedPathname.slice(prefix.length);
  if (encodedNext === "") return null;
  try {
    return codec.decode(encodedNext);
  } catch {
    // A malformed percent-sequence can only arrive if the previewed page
    // crafted a bogus pathname — treat it as "no navigation".
    return null;
  }
}
