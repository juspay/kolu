/** Parent-side adapter that turns native text selections inside a host
 *  element into a debounced `{ locator, rect }` signal — drives the
 *  `SelectionPill` placement and feeds the composer on activation.
 *
 *  Mounted on:
 *    - `BrowseFileView.tsx` (text browse, Pierre's `FileView` host)
 *    - The diff branch in `CodeTab.tsx` (Pierre's `FileDiff` host)
 *
 *  The HTML-iframe surface uses the in-iframe SDK instead (this hook
 *  doesn't fire inside the iframe — opaque origin + sandbox isolation). */

import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { extractQuote, type Locator } from "@kolu/artifact-sdk/client";
import { useComposer } from "./composerState";

export type SelectionCaptured = {
  locator: Locator;
  rect: { x: number; y: number; width: number; height: number };
};

export interface UseTextSelectionOptions {
  /** The reactive host element whose subtree's selections we care about. */
  host: Accessor<HTMLElement | undefined>;
  /** Selections crossing outside the host are ignored. */
  /** Path the captured comment will be anchored to. Reactive — the
   *  composer captures the value at activation time, not at mount. */
  path: Accessor<string | null>;
}

const DEBOUNCE_MS = 80;

/** Walk up + into shadow trees to determine if `node` is inside `host`.
 *  Pierre's open shadow DOM means a `Range`'s `commonAncestorContainer`
 *  may live below a shadow root; `.contains()` on the host doesn't
 *  cross shadow boundaries on its own. */
function nodeInside(host: HTMLElement, node: Node | null): boolean {
  let cur: Node | null = node;
  while (cur) {
    if (cur === host) return true;
    if (cur.parentNode) {
      cur = cur.parentNode;
      continue;
    }
    // No parent — might be inside a shadow root. Hop to its host.
    const root = (cur as Node & { getRootNode: () => Node }).getRootNode();
    if (root instanceof ShadowRoot) {
      cur = root.host;
      continue;
    }
    return false;
  }
  return false;
}

/** Read the active text selection, looking through any open shadow roots
 *  descending from `host`. `window.getSelection()` cannot return
 *  selections whose anchor/focus is inside a shadow tree (per spec);
 *  `ShadowRoot.getSelection()` is Chrome's escape hatch for that case.
 *  Pierre's `FileView` and `FileDiff` both render into a
 *  `<diffs-container>` custom element whose `attachShadow({mode: "open"})`
 *  is the user-visible text — so without this walk, real user drags
 *  inside Pierre look "empty" to `window.getSelection()` and the pill
 *  never appears.
 *
 *  Returns the first non-collapsed selection found inside the host, or
 *  the document selection as a fallback (covers non-shadow surfaces and
 *  browsers without the Chrome-specific shadow API). */
function getShadowAwareSelection(host: HTMLElement): Selection | null {
  const stack: Element[] = [host];
  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) continue;
    const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
    if (sr) {
      const getSel = (sr as ShadowRoot & { getSelection?: () => Selection })
        .getSelection;
      const inShadow = typeof getSel === "function" ? getSel.call(sr) : null;
      if (inShadow && inShadow.rangeCount > 0 && !inShadow.isCollapsed) {
        return inShadow;
      }
      for (const child of Array.from(sr.children)) stack.push(child);
    }
    for (const child of Array.from(el.children)) stack.push(child);
  }
  return window.getSelection();
}

export function useTextSelection(opts: UseTextSelectionOptions) {
  const composer = useComposer();
  const [captured, setCaptured] = createSignal<SelectionCaptured | null>(null);
  let lastRange: Range | null = null;
  let debounceHandle = 0;

  const evaluate = (): void => {
    const host = opts.host();
    if (!host) {
      setCaptured(null);
      return;
    }
    if (composer.isComposing()) return; // draft wins; ignore new selections
    const sel = getShadowAwareSelection(host);
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      lastRange = null;
      setCaptured(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!nodeInside(host, range.commonAncestorContainer)) {
      lastRange = null;
      setCaptured(null);
      return;
    }
    const text = range.toString();
    if (text.trim().length === 0) {
      lastRange = null;
      setCaptured(null);
      return;
    }
    lastRange = range;
    // Pick the last visual rect — for multi-line selections, the bbox
    // would place the pill far off to the right of the last line's end.
    const rects = range.getClientRects();
    const last =
      rects.length > 0
        ? rects[rects.length - 1]
        : range.getBoundingClientRect();
    if (!last) {
      setCaptured(null);
      return;
    }
    // Lazy-build the locator — extractQuote walks the DOM, so don't pay
    // for it on every selection tick if the user is just dragging.
    setCaptured({
      // We rebuild locator at activation time in `activate`; carry a
      // placeholder to keep the shape stable for the pill placement.
      locator: { quote: text, prefix: "", suffix: "" },
      rect: {
        x: last.left,
        y: last.top,
        width: last.width,
        height: last.height,
      },
    });
  };

  const onSelectionChange = (): void => {
    clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(
      evaluate,
      DEBOUNCE_MS,
    ) as unknown as number;
  };

  /** Called by the pill's onActivate. Re-reads the live range, builds
   *  the real W3C-style locator, and hands it to the composer. */
  const activate = (): void => {
    const host = opts.host();
    if (!host || !lastRange || composer.isComposing()) return;
    const path = opts.path();
    if (path === null) return;
    const ownerDoc = host.ownerDocument ?? document;
    // Prefer the shadow root containing the range — Pierre's content
    // lives there, and walking from the document root won't see the
    // shadow's text nodes for prefix/suffix extraction.
    const rootNode = lastRange.commonAncestorContainer.getRootNode();
    const resolvedRoot: Document | ShadowRoot =
      rootNode instanceof ShadowRoot ? rootNode : ownerDoc;
    const locator = extractQuote(lastRange, resolvedRoot);
    const rects = lastRange.getClientRects();
    const last =
      rects.length > 0
        ? rects[rects.length - 1]
        : lastRange.getBoundingClientRect();
    composer.open({
      path,
      locator,
      rect: last
        ? { x: last.left, y: last.top, width: last.width, height: last.height }
        : { x: 0, y: 0, width: 0, height: 0 },
    });
    setCaptured(null);
    // Clear whichever selection actually holds the range — shadow-root
    // selections are invisible to `window.getSelection()`, so calling
    // removeAllRanges on the document selection silently no-ops.
    const sel = getShadowAwareSelection(host);
    sel?.removeAllRanges();
  };

  onMount(() => {
    document.addEventListener("selectionchange", onSelectionChange);
  });

  // Re-evaluate when composing closes — user may have selected text and
  // immediately opened another composer; we should be ready.
  createEffect(() => {
    if (!composer.isComposing()) evaluate();
  });

  onCleanup(() => {
    document.removeEventListener("selectionchange", onSelectionChange);
    clearTimeout(debounceHandle);
  });

  return { captured, activate };
}
