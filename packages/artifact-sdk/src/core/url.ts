export function parseHttpUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/** Both sides of the external-link path call it — the in-iframe
 *  `classifyAnchor` classifier (iframe/deepLink.ts, against the previewed
 *  document's origin) and the parent's `observeIframeOpenExternal` re-check
 *  (client/bridge.ts, against kolu's own origin). Those two evaluations stay
 *  (defense in depth: the parent can't trust the iframe's filter across the
 *  postMessage boundary). */
export function isCrossOriginHttpUrl(url: URL | null, origin: string): boolean {
  return url !== null && url.origin !== origin;
}

/** Both sides of the deep-link path call it — the in-iframe classifier
 *  (iframe/deepLink.ts) and the parent's `observeIframeDeepLink` re-check
 *  (client/bridge.ts). Those two evaluations stay (defense in depth: the
 *  parent can't trust the iframe across the postMessage boundary). */
export function isDeepLinkHash(hash: string): boolean {
  return hash.startsWith("#/");
}
