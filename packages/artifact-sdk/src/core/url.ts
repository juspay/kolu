/** Parse `raw` as an absolute `http:`/`https:` URL, or `null` for anything
 *  else (unparseable, or a non-web scheme like `mailto:` / `javascript:`). The
 *  one place the package's scheme policy lives. */
export function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    // `new URL()` throws for any unparseable string — not http(s).
    return null;
  }
}

/** The single definition of "an openable external web URL" for the
 *  artifact-sdk package: a {@link parseHttpUrl} result at a DIFFERENT origin
 *  than `origin`. Origin (not host) is the boundary, so a same-host link over
 *  another scheme still counts as external. Both sides of the external-link
 *  path call it — the in-iframe `classifyAnchor` classifier
 *  (iframe/deepLink.ts, against the previewed document's origin) and the
 *  parent's `observeIframeOpenExternal` re-check (client/bridge.ts, against
 *  kolu's own origin). Those two evaluations stay (defense in depth: the
 *  parent can't trust the iframe's filter across the postMessage boundary),
 *  but the policy lives here once, so changing it is a single-site change. */
export function isCrossOriginHttpUrl(url: URL | null, origin: string): boolean {
  return url !== null && url.origin !== origin;
}

/** The single definition of kolu's deep-link hash namespace for the
 *  artifact-sdk package: a fragment in the `#/` namespace. Both sides of the
 *  deep-link path call it — the in-iframe classifier (iframe/deepLink.ts) and
 *  the parent's `observeIframeDeepLink` re-check (client/bridge.ts). Those two
 *  evaluations stay (defense in depth: the parent can't trust the iframe
 *  across the postMessage boundary), but the namespace policy lives here once,
 *  so changing it is a single-site change. */
export function isDeepLinkHash(hash: string): boolean {
  return hash.startsWith("#/");
}
