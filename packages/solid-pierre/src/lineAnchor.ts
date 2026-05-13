/** SolidJS primitive for anchoring a floating element to the right edge
 *  of a Pierre-rendered code line.
 *
 *  Pierre virtualizes via `transform: translateY`, which does NOT fire
 *  `scroll` events — so a one-shot measure + scroll-listener combo
 *  misses transform-driven reflows. The continuous `requestAnimationFrame`
 *  loop here is the only reliable way to keep an overlay glued to a
 *  moving line while scrolling. One `getBoundingClientRect` per frame is
 *  cheap.
 *
 *  Pierre's diff renderer attaches an open shadow root to its
 *  `<diffs-container>` custom element, so the line lookup walks shadow
 *  trees too via `deepQuerySelector`. The browse-mode `FileView` renders
 *  in the light DOM, but the same selector works there because the
 *  function tries the host directly before descending into shadow roots.
 *
 *  `Range.getBoundingClientRect` is unreliable for Pierre's tokenized
 *  inline content (each syntax token is a separate span; the Range
 *  collapses to a zero-width rect across browsers). The primitive
 *  iterates the line's child rects and takes the rightmost edge — robust
 *  for grid-rendered diff lines AND plain file-view lines. */

import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

/** Walks open shadow roots — Pierre's `<diffs-container>` exposes one
 *  for its diff renderer. Returns the first descendant matching
 *  `selector` anywhere under `root` (light DOM, then shadow roots,
 *  recursively). */
export function deepQuerySelector(
  root: HTMLElement | ShadowRoot,
  selector: string,
): HTMLElement | null {
  const direct = root.querySelector<HTMLElement>(selector);
  if (direct) return direct;
  for (const host of root.querySelectorAll<HTMLElement>("*")) {
    const sr = host.shadowRoot;
    if (!sr) continue;
    const found = deepQuerySelector(sr, selector);
    if (found) return found;
  }
  return null;
}

/** Anchor position in viewport coordinates (the same space `position:
 *  fixed` consumes). `null` means "don't render" — either the loop is
 *  inactive, the target is missing, the viewer is collapsed, or the
 *  line is scrolled out of view. */
export type LineAnchorPos = {
  /** Right edge of the line's text content. Use this as the `left` for
   *  a popover/bubble positioned to the right of the line. */
  rightEdge: number;
  /** Top of the line. */
  top: number;
};

export interface UsePierreLineAnchorOptions {
  /** Viewer scroll-root. Returns null while unmounted. The primitive
   *  searches under this root for the target line and also reads its
   *  bounding rect to detect "viewer is collapsed" (zero-sized). */
  viewerEl: Accessor<HTMLElement | null>;
  /** The line element to anchor to. Returning null hides the anchor —
   *  the caller is responsible for resolving via `deepQuerySelector`
   *  (e.g. `[data-selected-line]` for the user's current selection, or
   *  `[data-line="42"]` for a specific line number). */
  resolveTarget: Accessor<HTMLElement | null>;
  /** When false, the loop stops and `pos` returns null. Lets the caller
   *  cheaply pause anchoring without unmounting the component. */
  active: Accessor<boolean>;
}

/** Returns a position accessor that re-measures every frame while
 *  `active` is true. Caller applies any pixel offsets and clamps before
 *  writing the value to a `position: fixed` style. */
export function usePierreLineAnchor(
  opts: UsePierreLineAnchorOptions,
): Accessor<LineAnchorPos | null> {
  const [pos, setPos] = createSignal<LineAnchorPos | null>(null);

  const measure = () => {
    if (!opts.active()) {
      setPos(null);
      return;
    }
    const viewer = opts.viewerEl();
    if (!viewer) {
      setPos(null);
      return;
    }
    // Viewer hidden (right panel collapsed, inspector tab active) → its
    // layout rect collapses. Don't render an orphan overlay over
    // unrelated UI.
    const vrect = viewer.getBoundingClientRect();
    if (vrect.width === 0 || vrect.height === 0) {
      setPos(null);
      return;
    }
    const line = opts.resolveTarget();
    if (!line) {
      setPos(null);
      return;
    }
    const lineRect = line.getBoundingClientRect();
    let rightEdge = lineRect.left;
    for (const child of Array.from(line.children)) {
      const r = (child as HTMLElement).getBoundingClientRect();
      if (r.right > rightEdge) rightEdge = r.right;
    }
    // Empty lines have no children — fall back to a small inset from
    // the line's left edge so the overlay is still discoverable.
    if (rightEdge === lineRect.left) rightEdge = lineRect.left + 8;
    // Hide when the line scrolled out of the viewer.
    if (lineRect.bottom < vrect.top || lineRect.top > vrect.bottom) {
      setPos(null);
      return;
    }
    setPos({ rightEdge, top: lineRect.top });
  };

  createEffect(() => {
    // Track active so the effect restarts when the caller flips it.
    opts.active();
    let raf: number | undefined;
    const loop = () => {
      if (!opts.active()) {
        setPos(null);
        return;
      }
      measure();
      raf = requestAnimationFrame(loop);
    };
    loop();
    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf);
    });
  });

  return pos;
}
