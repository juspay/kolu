/** In-iframe artifact-sdk script. Bundled by esbuild at server startup
 *  (see `../server/bundle.ts`) and served as `/api/artifact-sdk.js?v=<hash>`
 *  to the iframe sandboxed at opaque origin (`allow-scripts` only — no
 *  `allow-same-origin`). The iframe and parent communicate by postMessage
 *  alone; the parent validates by `event.source === iframeRef.contentWindow`
 *  identity since `event.origin` is `"null"` under the opaque sandbox.
 *
 *  This is the single in-iframe agent in the opaque-origin sandbox. It
 *  forwards to the parent the in-frame intents the sandbox traps — events
 *  that never reach the parent because they fire inside the frame:
 *    - Text selection → on pill click, post `SelectMsg` (built from a
 *      Locator via the shared `extractQuote`, surfaced as a floating
 *      "+ Comment" pill at the selection's end).
 *    - Same-frame link navigation → `ReadyMsg.pathname` on every boot, so
 *      the parent learns where a link click went.
 *    - Mouse back/forward (X1/X2) → `HistoryMsg`, so the parent drives its
 *      own history.
 *  It also applies CSS Custom Highlights for the comment set the parent
 *  pushes via `RenderHighlightsMsg`. */

import { attachBackForwardMouse } from "@kolu/solid-browser/backForward";
import { match } from "ts-pattern";
import { applyHighlights } from "../core/applyHighlights";
import { extractQuote } from "../core/extractQuote";
import { COMMENT_HIGHLIGHT_STYLE } from "../core/theme";
import type {
  HistoryMsg,
  Locator,
  OpenExternalMsg,
  ParentToIframe,
  ReadyMsg,
  SelectMsg,
} from "../types";

const HIGHLIGHT_NAME = "kolu-artifact-sdk-comment";
const PILL_ID = "kolu-artifact-sdk-pill";

let currentPath: string | null = null;
let lastSelectionRange: Range | null = null;
let pillEl: HTMLDivElement | null = null;

function postToParent(
  msg: SelectMsg | ReadyMsg | HistoryMsg | OpenExternalMsg,
): void {
  window.parent.postMessage(msg, "*");
}

/** The absolute URL to open in a real browser tab when `anchor` is clicked, or
 *  null to let the click proceed in-frame. A link is "external" when it loads
 *  over http(s) at a different origin than the previewed document: same-origin
 *  links stay in-frame (the parent maps them back to a repo path via the `ready`
 *  pathname report) and non-web schemes (`mailto:`, fragment-only `#foo`,
 *  `javascript:`) are left to the browser's own handling. Origin (not host) is
 *  the boundary so a same-host link over a different scheme — e.g. `http:` vs
 *  the document's `https:` — is correctly treated as external. `anchor.href` is
 *  already resolved absolute against the document's base URL. */
function externalHref(anchor: HTMLAnchorElement): string | null {
  let url: URL;
  try {
    url = new URL(anchor.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin === window.location.origin) return null;
  return url.href;
}

/** Trap a primary- or middle-button click on an external anchor and forward it
 *  to the parent. The opaque-origin sandbox carries no `allow-popups`/`allow-
 *  top-navigation`, so the browser would otherwise swallow the click or replace
 *  the preview in-pane; the parent opens the URL in a real tab instead. Bubble
 *  phase + a `defaultPrevented` guard so a page that handles its own links wins.
 *  We don't branch on the button: primary and middle (auxclick, the "open in a
 *  new tab" gesture) resolve to the same destination — a new tab — and modifier
 *  combos likewise, since the sandbox would swallow them all otherwise. The
 *  `click` event already covers a left-button press; `auxclick` is wired
 *  separately in `boot` for the middle button, which never fires `click`. */
function onAnchorClick(event: MouseEvent): void {
  // `click` only fires for the primary button; `auxclick` carries button 1
  // (middle) and 2 (right). Trap left and middle — both mean "follow the link";
  // leave the right button to the context menu.
  if (event.defaultPrevented || (event.button !== 0 && event.button !== 1)) {
    return;
  }
  const anchor = (event.target as Element | null)?.closest("a");
  if (!anchor) return;
  const url = externalHref(anchor);
  if (url === null) return;
  event.preventDefault();
  postToParent({ type: "kolu-artifact-sdk:open-external", url });
}

function clearPill(): void {
  if (pillEl) {
    pillEl.remove();
    pillEl = null;
  }
}

function showPill(rect: DOMRect): void {
  clearPill();
  if (currentPath === null) return;
  const el = document.createElement("div");
  el.id = PILL_ID;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", "Add comment on selected text");
  Object.assign(el.style, {
    position: "absolute",
    top: `${window.scrollY + rect.bottom + 4}px`,
    left: `${window.scrollX + rect.right + 4}px`,
    zIndex: "2147483647",
    background: "#1f1d18",
    color: "white",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontSize: "12px",
    padding: "4px 10px 4px 8px",
    borderRadius: "14px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    userSelect: "none",
  });
  el.innerHTML =
    '<span style="background:#b8431e;color:white;width:14px;height:14px;border-radius:50%;font-size:11px;display:inline-flex;align-items:center;justify-content:center;font-weight:600;line-height:1;">+</span>Comment';
  el.addEventListener("mousedown", (e) => {
    // mousedown rather than click — by the time `click` fires, browsers
    // have already collapsed the selection from clicking outside the
    // selected text. Capture state synchronously here, suppress default,
    // then post.
    e.preventDefault();
    e.stopPropagation();
    if (!lastSelectionRange || currentPath === null) return;
    const range = lastSelectionRange;
    const locator: Locator = extractQuote(range, document);
    const r = range.getBoundingClientRect();
    postToParent({
      type: "kolu-artifact-sdk:select",
      path: currentPath,
      locator,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    });
    clearPill();
    window.getSelection()?.removeAllRanges();
  });
  document.body.appendChild(el);
  pillEl = el;
}

let pillDebounce = 0;
function onSelectionChange(): void {
  clearTimeout(pillDebounce);
  pillDebounce = window.setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      lastSelectionRange = null;
      clearPill();
      return;
    }
    const range = sel.getRangeAt(0);
    const text = range.toString();
    if (text.trim().length === 0) {
      lastSelectionRange = null;
      clearPill();
      return;
    }
    lastSelectionRange = range;
    const rects = range.getClientRects();
    const last =
      rects.length > 0
        ? rects[rects.length - 1]
        : range.getBoundingClientRect();
    showPill(last as DOMRect);
  }, 80);
}

// Highlight rendering delegates to `core/applyHighlights` — same
// algorithm the parent-side overlay uses, just rooted at this iframe's
// document. The shared core function guards on browser support so
// older browsers degrade silently.

function ensureHighlightStyle(): void {
  if (document.getElementById("kolu-artifact-sdk-style")) return;
  const style = document.createElement("style");
  style.id = "kolu-artifact-sdk-style";
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { ${COMMENT_HIGHLIGHT_STYLE} }`;
  document.head.appendChild(style);
}

function onMessage(event: MessageEvent<ParentToIframe>): void {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  // `postMessage` is a network-grade boundary — any embedder can send
  // arbitrary payloads. `otherwise(() => undefined)` ignores unknown
  // message shapes (forward-compat with a newer parent, defense
  // against unrelated messages) instead of letting `NonExhaustiveError`
  // crash the SDK.
  match(msg)
    .with({ type: "kolu-artifact-sdk:path" }, (m) => {
      currentPath = m.path;
    })
    .with({ type: "kolu-artifact-sdk:render-highlights" }, (m) => {
      applyHighlights(window, document, m.comments, HIGHLIGHT_NAME);
    })
    .otherwise(() => undefined);
}

function boot(): void {
  ensureHighlightStyle();
  document.addEventListener("selectionchange", onSelectionChange);
  // External links can't escape the opaque-origin sandbox on their own
  // (`allow-scripts` only — no `allow-popups`/`allow-top-navigation`), so trap
  // their clicks and ask the parent to open them in a real browser tab.
  document.addEventListener("click", onAnchorClick);
  // Middle-click (the "open in a new tab" gesture) fires `auxclick`, not
  // `click`, so the external-link trap needs both to cover it. Same handler:
  // it already guards on `event.button`.
  document.addEventListener("auxclick", onAnchorClick);
  window.addEventListener("message", onMessage);
  // The mouse's dedicated back/forward (X1/X2) buttons. The opaque-origin
  // sandbox traps them in this frame, so the parent can't see them; forward the
  // intent so the Code-tab browser's history responds the same over a preview as
  // over the file tree. The shared binder owns the swallow-on-down /
  // act-on-up / preventDefault-on-both protocol so the frame's own native
  // back/forward is suppressed and only the host navigates. (SVG/PDF previews
  // carry no SDK, so this covers HTML previews.)
  attachBackForwardMouse(window, {
    onBack: () =>
      postToParent({ type: "kolu-artifact-sdk:history", direction: "back" }),
    onForward: () =>
      postToParent({ type: "kolu-artifact-sdk:history", direction: "forward" }),
  });
  // `location.pathname` lets the parent follow same-frame link navigation:
  // it can't read this frame's URL across the opaque-origin sandbox, so the
  // frame reports its own on every boot (initial load + each post-link load).
  postToParent({
    type: "kolu-artifact-sdk:ready",
    pathname: window.location.pathname,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
