/** The kolu deep-link classifier for anchors clicked inside the previewed
 *  document — a pure sibling of `index.ts`'s `externalHref`, extracted so the
 *  node-env unit suite can pin it without importing the iframe entry (whose
 *  module-level boot touches `document`). */

import { isDeepLinkHash, isHttpUrl } from "../core/url";

/** The `#/…` deep-link hash carried by `anchor`, or null when the click is not
 *  a kolu deep link. A deep link is a SAME-ORIGIN anchor whose fragment starts
 *  with `#/` — kolu's deep-link namespace (an ordinary in-page anchor is
 *  `#section`, never `#/…`) — that performs no file navigation: its path is
 *  the app root (`/#/t/…`, the shape an orchestrator dashboard emits) or the
 *  previewed document's own path (a bare `#/t/…` href resolves there). A
 *  same-origin link to a DIFFERENT path is file navigation and stays in-frame
 *  regardless of its hash. Only this cheap shape test lives in the sandbox —
 *  the PARENT runs the real grammar parse, so an invalid `#/bogus` toasts
 *  exactly as the same hash typed into the address bar would. Callers classify
 *  external FIRST (a cross-origin `#/…` is still an external link).
 *
 *  `loc` is the previewed document's own location (`window.location` at the
 *  call site) — passed in, not read from a global, so the classifier is pure. */
export function koluDeepLinkHash(
  anchor: Pick<HTMLAnchorElement, "href">,
  loc: Pick<Location, "origin" | "pathname">,
): string | null {
  if (!isHttpUrl(anchor.href)) return null;
  const url = new URL(anchor.href);
  if (url.origin !== loc.origin) return null;
  if (!isDeepLinkHash(url.hash)) return null;
  const isFileNav = url.pathname !== "/" && url.pathname !== loc.pathname;
  return isFileNav ? null : url.hash;
}
