/** In-iframe artifact-sdk script. Bundled by esbuild at server startup
 *  (see `../server/bundle.ts`) and served as `/api/artifact-sdk.js?v=<hash>`
 *  to the iframe sandboxed at opaque origin (`allow-scripts` only — no
 *  `allow-same-origin`). The iframe and parent communicate by postMessage
 *  alone; the parent validates by `event.source === iframeRef.contentWindow`
 *  identity since `event.origin` is `"null"` under the opaque sandbox.
 *
 *  Three responsibilities:
 *    1. Capture text selections inside the iframe document, build a Locator
 *       via the shared `extractQuote`, and surface a floating "+ Comment"
 *       pill at the selection's end.
 *    2. On pill click, post `SelectMsg` to the parent.
 *    3. Apply CSS Custom Highlights for the comment set the parent pushes
 *       via `RenderHighlightsMsg`. */

import { match } from "ts-pattern";
import { applyHighlights } from "../core/applyHighlights";
import { extractQuote } from "../core/extractQuote";
import { COMMENT_HIGHLIGHT_STYLE } from "../core/theme";
import type {
  HistoryMsg,
  Locator,
  ParentToIframe,
  ReadyMsg,
  SelectMsg,
} from "../types";

const HIGHLIGHT_NAME = "kolu-artifact-sdk-comment";
const PILL_ID = "kolu-artifact-sdk-pill";

let currentPath: string | null = null;
let lastSelectionRange: Range | null = null;
let pillEl: HTMLDivElement | null = null;

function postToParent(msg: SelectMsg | ReadyMsg | HistoryMsg): void {
  window.parent.postMessage(msg, "*");
}

/** The mouse's dedicated back/forward (X1/X2) buttons — `button` 3 and 4.
 *  The opaque-origin sandbox traps these in this frame, so the parent can't
 *  see them; forward the intent so the Code-tab browser's history responds the
 *  same over a preview as over the file tree. `preventDefault` on both down and
 *  up suppresses the frame's own native back/forward so only the host
 *  navigates. (SVG/PDF previews carry no SDK, so this covers HTML previews.) */
function onHistoryButton(e: MouseEvent): void {
  if (e.button !== 3 && e.button !== 4) return;
  e.preventDefault();
  if (e.type !== "mouseup") return;
  postToParent({
    type: "kolu-artifact-sdk:history",
    direction: e.button === 3 ? "back" : "forward",
  });
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
  window.addEventListener("message", onMessage);
  // Forward the mouse back/forward (X1/X2) buttons to the parent — swallow on
  // the way down so the frame doesn't start its own navigation, act on the up.
  window.addEventListener("mousedown", onHistoryButton);
  window.addEventListener("mouseup", onHistoryButton);
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
