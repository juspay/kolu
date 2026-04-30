/** Shared scaffold for "popover anchored beneath a trigger element."
 *
 *  Returns a `panelRef` callback and a reactive `panelStyle` accessor;
 *  the caller renders the panel via `<Portal>` and binds both. The hook
 *  owns:
 *    - viewport-clamped positioning (`bottom-start` left-anchored or
 *      `bottom-end` right-anchored, recomputed on open/trigger change),
 *    - document-level outside-click dismiss (active only while open),
 *    - Escape-key dismiss (same).
 *
 *  Dismiss is delivered via `onDismiss`, never inside the hook — callers
 *  with controlled open state, derived open state, or internal open
 *  state all wire the same way. */

import { createEventListener } from "@solid-primitives/event-listener";
import { createEffect, createSignal, type JSX } from "solid-js";

export type AnchorSide = "bottom-start" | "bottom-end";

export type UseAnchoredPopoverOpts = {
  /** Accessor for the trigger element. Allows signal-backed refs that
   *  change identity (e.g. a button that remounts) to reposition the
   *  popover automatically. */
  triggerRef: () => HTMLElement | undefined;
  /** Accessor for current open state. Document listeners are attached
   *  only while this returns `true`. */
  open: () => boolean;
  /** Called when the user clicks outside the panel/trigger or presses
   *  Escape. The hook never mutates state itself. */
  onDismiss: () => void;
  /** Defaults to `"bottom-start"` (left-anchored, viewport-clamped).
   *  `"bottom-end"` right-anchors to the trigger. */
  anchor?: AnchorSide;
  /** Min panel width — used for viewport clamping when
   *  `anchor === "bottom-start"`. Defaults to 0 (no clamp). */
  panelMinWidth?: number;
  /** Vertical offset below the trigger's bottom edge. Defaults to 4px. */
  offset?: number;
};

export type UseAnchoredPopover = {
  panelRef: (el: HTMLElement) => void;
  panelStyle: () => JSX.CSSProperties;
};

const VIEWPORT_PAD = 8;

export function useAnchoredPopover(
  opts: UseAnchoredPopoverOpts,
): UseAnchoredPopover {
  let panelEl: HTMLElement | undefined;
  const [pos, setPos] = createSignal<{
    top: number;
    left?: number;
    right?: number;
  }>({ top: 0 });

  const updatePos = () => {
    const t = opts.triggerRef();
    if (!t) return;
    const r = t.getBoundingClientRect();
    const top = r.bottom + (opts.offset ?? 4);
    if (opts.anchor === "bottom-end") {
      setPos({ top, right: window.innerWidth - r.right });
      return;
    }
    const minW = opts.panelMinWidth ?? 0;
    const maxLeft = window.innerWidth - minW - VIEWPORT_PAD;
    const left = Math.max(VIEWPORT_PAD, Math.min(r.left, maxLeft));
    setPos({ top, left });
  };

  // Document listeners exist only while the popover is open — passing
  // `undefined` as the target detaches them.
  const docTarget = () => (opts.open() ? document : undefined);
  createEventListener(docTarget, "mousedown", (e) => {
    const node = e.target as Node;
    const t = opts.triggerRef();
    if (panelEl?.contains(node) || t?.contains(node)) return;
    opts.onDismiss();
  });
  createEventListener(docTarget, "keydown", (e) => {
    if (e.key === "Escape") opts.onDismiss();
  });

  // Reposition when the trigger ref or open state changes — covers both
  // first open and trigger remounts (e.g. a button that re-renders).
  createEffect(() => {
    if (opts.open() && opts.triggerRef()) updatePos();
  });

  const panelRef = (el: HTMLElement) => {
    panelEl = el;
    updatePos();
  };

  const panelStyle = (): JSX.CSSProperties => {
    const p = pos();
    return p.right !== undefined
      ? { top: `${p.top}px`, right: `${p.right}px` }
      : { top: `${p.top}px`, left: `${p.left}px` };
  };

  return { panelRef, panelStyle };
}
