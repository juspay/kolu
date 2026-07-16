/** The single definition of "an openable external web URL" scheme predicate
 *  for the artifact-sdk package: true only for an absolute `http:`/`https:`
 *  URL. Both sides of the external-link path call it — the in-iframe
 *  `classifyAnchor` classifier (iframe/deepLink.ts) and the parent's
 *  `observeIframeOpenExternal` re-check (client/bridge.ts). Those two
 *  evaluations stay (defense in depth: the parent can't trust the iframe's
 *  filter across the postMessage boundary), but the scheme policy lives here
 *  once, so allowing another scheme — or tightening to https-only — is a
 *  single-site change. */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    // `new URL()` throws for any unparseable string — not http(s).
    return false;
  }
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
