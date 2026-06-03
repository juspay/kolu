/** URL-scheme policy shared across the parse (./render) and sanitize
 *  (./sanitize) layers. This is a third, independent axis of change — "which
 *  URL schemes are safe to keep" — owned by neither layer: the renderer
 *  allowlists the hrefs it mints, and the sanitizer re-applies the same policy
 *  to inline-HTML anchors + decides which image srcs load as written. DOM-free,
 *  so the parse contract stays Node-testable. */

/** Allowlist a URL for use as an `href`. Returns the original string when
 *  safe, else `undefined` (the caller then renders inert text). DOM-free:
 *  resolves relative refs against a fixed base so we can read the *effective*
 *  scheme without a `window`. Blocks `javascript:`, `data:`, `vbscript:` and
 *  any other script-capable scheme; allows http(s), mailto, and in-page
 *  anchors. */
export function safeHref(href: string): string | undefined {
  const trimmed = href.trim();
  if (trimmed === "") return undefined;
  if (trimmed.startsWith("#")) return trimmed; // in-page anchor
  let url: URL;
  try {
    // A relative or protocol-relative ref carries no scheme of its own;
    // resolving against an https base surfaces the effective protocol so the
    // check below is uniform for absolute and relative hrefs alike.
    url = new URL(trimmed, "https://markdown.local/");
  } catch {
    return undefined; // unparseable → treat as unsafe, render as plain text
  }
  const ok =
    url.protocol === "http:" ||
    url.protocol === "https:" ||
    url.protocol === "mailto:";
  return ok ? trimmed : undefined;
}

/** Does this ref carry an origin/scheme of its own — i.e. it is NOT a bare
 *  repo-relative path? True for a protocol-relative `//host`, anything with a
 *  scheme (`https:`, `data:`, `mailto:`, …), and an in-page `#anchor`. The
 *  image resolver uses this to bail before treating a src as a repo path; it is
 *  the shape decision shared with `safeHref` (which then *allowlists* among the
 *  schemes), kept in one place so "has its own origin" is encoded once. */
export function hasOwnScheme(src: string): boolean {
  const trimmed = src.trim();
  return (
    trimmed.startsWith("#") || // in-page anchor (own "origin": this document)
    trimmed.startsWith("//") || // protocol-relative `//host`
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) // an explicit scheme
  );
}

/** An image that loads directly as written — an absolute http(s) URL or an
 *  inline data:image URI. A repo-relative README src (`./docs/logo.png`) is
 *  NOT loadable as-is; it goes through the host's `resolveImageSrc` first. */
export function isLoadableImage(src: string): boolean {
  return /^(?:https?:\/\/|data:image\/)/i.test(src.trim());
}
