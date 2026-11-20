import { attachBackForwardMouse } from "@kolu/solid-browser/backForward";
import { attachPageZoomGuard } from "@kolu/solid-browser/pageZoom";
import { match } from "ts-pattern";
import { applyHighlights } from "../core/applyHighlights";
import { extractQuote } from "../core/extractQuote";
import { COMMENT_HIGHLIGHT_STYLE } from "../core/theme";
import { classifyAnchor } from "./deepLink";
import type {
  DeepLinkMsg,
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
  msg: SelectMsg | ReadyMsg | HistoryMsg | OpenExternalMsg | DeepLinkMsg,
): void {
  window.parent.postMessage(msg, window.location.origin);
}

function onAnchorClick(event: MouseEvent): void {
  if (event.defaultPrevented) return;
  const anchor = (event.target as Element | null)?.closest("a");
  if (!anchor) return;
  match(classifyAnchor(anchor, window.location, event))
    .with({ kind: "external" }, ({ url }) => {
      event.preventDefault();
      postToParent({ type: "kolu-artifact-sdk:open-external", url });
    })
    .with({ kind: "deep-link" }, ({ hash }) => {
      event.preventDefault();
      postToParent({ type: "kolu-artifact-sdk:deep-link", hash });
    })
    .with({ kind: "in-frame" }, () => undefined)
    .exhaustive();
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

function ensureHighlightStyle(): void {
  if (document.getElementById("kolu-artifact-sdk-style")) return;
  const style = document.createElement("style");
  style.id = "kolu-artifact-sdk-style";
  style.textContent = `::highlight(${HIGHLIGHT_NAME}) { ${COMMENT_HIGHLIGHT_STYLE} }`;
  document.head.appendChild(style);
}

function onMessage(event: MessageEvent<ParentToIframe>): void {
  // This document's security origin is opaque (sandboxed), but
  // `location.origin` still names the URL origin that loaded it, so the
  // origin half of this guard is meaningful.
  if (
    event.source !== window.parent ||
    event.origin !== window.location.origin
  ) {
    return;
  }
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  match(msg)
    .with({ type: "kolu-artifact-sdk:path" }, (m) => {
      currentPath = m.path;
    })
    .with({ type: "kolu-artifact-sdk:render-highlights" }, (m) => {
      applyHighlights(window, document, m.comments, HIGHLIGHT_NAME);
    })
    .otherwise(() => undefined);
}

function forwardTrappedIntents(win: Window): void {
  win.document.addEventListener("click", onAnchorClick);
  win.document.addEventListener("auxclick", onAnchorClick);
  attachBackForwardMouse(win, {
    onBack: () =>
      postToParent({ type: "kolu-artifact-sdk:history", direction: "back" }),
    onForward: () =>
      postToParent({ type: "kolu-artifact-sdk:history", direction: "forward" }),
  });
  postToParent({
    type: "kolu-artifact-sdk:ready",
    pathname: win.location.pathname,
  });
}

function boot(): void {
  ensureHighlightStyle();
  document.addEventListener("selectionchange", onSelectionChange);
  window.addEventListener("message", onMessage);
  // A pinch inside this frame is dispatched to THIS document and never reaches
  // the parent window, so the frame refuses page magnification itself — the
  // same shared guard, inside the sandbox (#2354).
  attachPageZoomGuard(window);
  forwardTrappedIntents(window);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
