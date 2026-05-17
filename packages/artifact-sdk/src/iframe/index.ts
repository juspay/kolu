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

import { extractQuote } from "../core/extractQuote";
import { findQuote, rangeFromOffsets } from "../core/findQuote";
import { COMMENT_HIGHLIGHT_STYLE } from "../core/theme";
import type { Locator, ParentToIframe, ReadyMsg, SelectMsg } from "../types";

const HIGHLIGHT_NAME = "kolu-artifact-sdk-comment";
const PILL_ID = "kolu-artifact-sdk-pill";

declare global {
  interface Window {
    CSS: {
      highlights?: {
        set(name: string, highlight: unknown): void;
        delete(name: string): void;
      };
    };
    /** Custom Highlight API constructor — not yet in lib.dom in all TS
     *  versions. Optional because pre-Chrome-105 browsers don't have it. */
    Highlight?: new (
      ...ranges: Range[]
    ) => unknown;
  }
}

let currentPath: string | null = null;
let lastSelectionRange: Range | null = null;
let pillEl: HTMLDivElement | null = null;

function postToParent(msg: SelectMsg | ReadyMsg): void {
  window.parent.postMessage(msg, "*");
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

function applyHighlights(
  comments: Array<{ id: string; locator: Locator }>,
): void {
  const HighlightCtor = window.Highlight;
  if (!HighlightCtor || !window.CSS.highlights) return;
  const text = document.body?.textContent ?? "";
  const ranges: Range[] = [];
  for (const c of comments) {
    const match = findQuote(text, c.locator);
    if (!match) continue;
    const range = rangeFromOffsets(document, match.start, match.end);
    if (range) ranges.push(range);
  }
  if (ranges.length === 0) {
    window.CSS.highlights.delete(HIGHLIGHT_NAME);
    return;
  }
  window.CSS.highlights.set(HIGHLIGHT_NAME, new HighlightCtor(...ranges));
}

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
  switch (msg.type) {
    case "kolu-artifact-sdk:path":
      currentPath = msg.path;
      break;
    case "kolu-artifact-sdk:render-highlights":
      applyHighlights(msg.comments);
      break;
  }
}

function boot(): void {
  ensureHighlightStyle();
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("message", onMessage);
  postToParent({ type: "kolu-artifact-sdk:ready" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
