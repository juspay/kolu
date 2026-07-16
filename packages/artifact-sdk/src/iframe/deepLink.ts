/** The anchor-click classifier for the previewed document — pure, extracted
 *  from `index.ts` so the node-env unit suite can pin it without importing the
 *  iframe entry (whose module-level boot touches `document`). */

import { isDeepLinkHash, isHttpUrl } from "../core/url";

/** Whether a mouse event is a PLAIN primary activation — the only gesture
 *  allowed to navigate the CURRENT window (a deep link routes the surrounding
 *  kolu app in place). A middle-click or a ctrl/cmd/shift/alt-click says "open
 *  ELSEWHERE, keep this page", so a deep link must stay inert for those — the
 *  sandbox swallows them, the same result they had before deep links existed.
 *  (External links are the opposite: every gesture already resolves to a new
 *  tab, so they trap gesture-agnostically.) */
export function isPlainPrimaryClick(
  event: Pick<
    MouseEvent,
    "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
  >,
): boolean {
  return (
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** What `onAnchorClick` does with a clicked anchor: open it in a real browser
 *  tab (`external`), ask the parent to route a kolu deep link (`deep-link`),
 *  or leave the click to the browser (`in-frame`). */
export type AnchorAction =
  | { kind: "external"; url: string }
  | { kind: "deep-link"; hash: string }
  | { kind: "in-frame" };

/** Classify a clicked anchor as external / kolu deep link / in-frame — the ONE
 *  place the sandbox's anchor policy lives.
 *
 *  A link is EXTERNAL when it loads over http(s) at a different origin than
 *  the previewed document. Origin (not host) is the boundary so a same-host
 *  link over a different scheme — e.g. `http:` vs the document's `https:` —
 *  is correctly treated as external. A cross-origin `#/…` is still an external
 *  link — the origin check runs before the hash check, so the two arms are
 *  mutually exclusive by construction, not by caller ordering.
 *
 *  A DEEP LINK is a same-origin anchor whose fragment starts with `#/` —
 *  kolu's deep-link namespace (an ordinary in-page anchor is `#section`,
 *  never `#/…`) — that performs no file navigation: its path is the app root
 *  (`/#/t/…`, the shape an orchestrator dashboard emits) or the previewed
 *  document's own path (a bare `#/t/…` href resolves there). A same-origin
 *  link to a DIFFERENT path is file navigation and stays in-frame regardless
 *  of its hash. Only this cheap shape test lives in the sandbox — the PARENT
 *  runs the real grammar parse, so an invalid `#/bogus` toasts exactly as the
 *  same hash typed into the address bar would.
 *
 *  Everything else is IN-FRAME: internal file navigation (the parent maps it
 *  back to a repo path via the `ready` pathname report), plain in-page
 *  `#section` anchors, and non-web schemes (`mailto:`, `javascript:`) left to
 *  the browser's own handling.
 *
 *  `anchor.href` is already resolved absolute against the document's base URL.
 *  `loc` is the previewed document's own location (`window.location` at the
 *  call site) — passed in, not read from a global, so the classifier is pure. */
export function classifyAnchor(
  anchor: Pick<HTMLAnchorElement, "href">,
  loc: Pick<Location, "origin" | "pathname">,
): AnchorAction {
  if (!isHttpUrl(anchor.href)) return { kind: "in-frame" };
  // `isHttpUrl` already proved `anchor.href` parses, so this `new URL` can't
  // throw — it's only here to read the origin/path/hash.
  const url = new URL(anchor.href);
  if (url.origin !== loc.origin) return { kind: "external", url: url.href };
  if (!isDeepLinkHash(url.hash)) return { kind: "in-frame" };
  const isFileNav = url.pathname !== "/" && url.pathname !== loc.pathname;
  return isFileNav
    ? { kind: "in-frame" }
    : { kind: "deep-link", hash: url.hash };
}
