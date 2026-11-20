import {
  extractOffsets,
  extractQuote,
  type QuoteRoot,
  rootTextContent,
  type SelectionRect,
} from "@kolu/artifact-sdk/client";
import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { codeViewItemIdAt } from "@kolu/solid-pierre";
import { walkShadowRoots } from "../dom/shadowWalk";
import { useShown } from "../ui/shown";
import { type ComposerTarget, useComposer } from "./composerState";
import type { BrowseSurface } from "./types";

export type SelectionCaptured = {
  rect: SelectionRect;
  unavailable?: string;
};

export interface UseTextSelectionOptions {
  host: Accessor<HTMLElement | undefined>;
  path: Accessor<string | null>;
  /** When false, the captured comment carries no `lineRange` — for
   *  rendered (non-source) surfaces like the Markdown preview, where a
   *  rendered-DOM line number is meaningless as a source-file line.
   *  Required — callers must make a deliberate choice; no silent default. */
  lineAnchored: Accessor<boolean>;
  /** Which browse surface this capture lives on, when the file offers a
   *  Source ⇄ Rendered toggle (Markdown). Recorded on the comment so the
   *  tray jump can restore that surface. Absent for single-surface views. */
  surface?: Accessor<BrowseSurface | undefined>;
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
    const root = (cur as Node & { getRootNode: () => Node }).getRootNode();
    if (root instanceof ShadowRoot) {
      cur = root.host;
      continue;
    }
    return false;
  }
  return false;
}

function lineRangeForSelection(
  root: QuoteRoot,
  range: Range,
): { start: number; end: number } | undefined {
  const offsets = extractOffsets(root, range);
  if (!offsets) return undefined;
  const text = rootTextContent(root);
  const lineAt = (off: number): number => {
    let n = 1;
    for (let i = 0; i < off && i < text.length; i++) {
      if (text[i] === "\n") n++;
    }
    return n;
  };
  return { start: lineAt(offsets.start), end: lineAt(offsets.end) };
}

/** Read the active text selection, looking through any open shadow roots
 *  descending from `host`. `window.getSelection()` cannot return
 *  selections whose anchor/focus is inside a shadow tree (per spec);
 *  `ShadowRoot.getSelection()` is Chrome's escape hatch for that case.
 *  Pierre's `CodeView` renders each item into a `<diffs-container>` custom
 *  element whose `attachShadow({mode: "open"})` is the user-visible text —
 *  so without this walk, real user drags inside Pierre look "empty" to
 *  `window.getSelection()` and the pill never appears.
 *
 *  Returns the first non-collapsed selection found inside the host, or
 *  the document selection as a fallback (covers non-shadow surfaces and
 *  browsers without the Chrome-specific shadow API). */
function getShadowAwareSelection(host: HTMLElement): Selection | null {
  const found = walkShadowRoots(host, (sr) => {
    const getSel = (sr as ShadowRoot & { getSelection?: () => Selection })
      .getSelection;
    const inShadow = typeof getSel === "function" ? getSel.call(sr) : null;
    if (inShadow && inShadow.rangeCount > 0 && !inShadow.isCollapsed) {
      return inShadow;
    }
    return undefined;
  });
  return found ?? window.getSelection();
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
    if (composer.isComposing()) return;
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
    const rects = range.getClientRects();
    const last =
      rects.length > 0
        ? rects[rects.length - 1]
        : range.getBoundingClientRect();
    if (!last) {
      setCaptured(null);
      return;
    }
    const path = opts.path();
    const itemPath = codeViewItemIdAt(range.commonAncestorContainer);
    setCaptured({
      rect: {
        x: last.left,
        y: last.top,
        width: last.width,
        height: last.height,
      },
      ...(path !== null && itemPath !== undefined && itemPath !== path
        ? {
            unavailable: `Comments here attach to ${path} only, not ${itemPath}`,
          }
        : {}),
    });
  };

  const onSelectionChange = (): void => {
    clearTimeout(debounceHandle);
    debounceHandle = window.setTimeout(
      evaluate,
      DEBOUNCE_MS,
    ) as unknown as number;
  };

  const handOffToComposer = (
    host: HTMLElement,
    target: ComposerTarget,
  ): void => {
    setCaptured(null);
    getShadowAwareSelection(host)?.removeAllRanges();
    composer.open(target);
  };

  const activate = (): void => {
    const host = opts.host();
    if (!host || !lastRange || composer.isComposing()) return;
    if (captured()?.unavailable !== undefined) return;
    const path = opts.path();
    if (path === null) return;
    const rootNode = lastRange.commonAncestorContainer.getRootNode();
    const resolvedRoot: QuoteRoot =
      rootNode instanceof ShadowRoot ? rootNode : host;
    const locator = extractQuote(lastRange, resolvedRoot);
    const lineRange = opts.lineAnchored()
      ? lineRangeForSelection(resolvedRoot, lastRange)
      : undefined;
    const rects = lastRange.getClientRects();
    const last =
      rects.length > 0
        ? rects[rects.length - 1]
        : lastRange.getBoundingClientRect();
    handOffToComposer(host, {
      path,
      locator,
      lineRange,
      surface: opts.surface?.(),
      rect: last
        ? { x: last.left, y: last.top, width: last.width, height: last.height }
        : { x: 0, y: 0, width: 0, height: 0 },
    });
  };

  const shown = useShown();
  createEffect(() => {
    if (!shown()) return;
    document.addEventListener("selectionchange", onSelectionChange);
    onCleanup(() => {
      document.removeEventListener("selectionchange", onSelectionChange);
      clearTimeout(debounceHandle);
    });
  });

  createEffect(() => {
    if (!composer.isComposing()) evaluate();
  });

  onCleanup(() => {
    document.removeEventListener("selectionchange", onSelectionChange);
    clearTimeout(debounceHandle);
  });

  return { captured, activate };
}
