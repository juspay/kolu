/** Shared scaffold for "popover anchored to a trigger element."
 *
 *  Returns a `panelRef` callback and a reactive `panelStyle` accessor;
 *  the caller renders the panel via `<Portal>` and binds both. The hook
 *  owns:
 *    - viewport-clamped positioning (`bottom-start` left-anchored,
 *      `bottom-end` right-anchored, `top-start` left-anchored above the
 *      trigger, or `top-end` right-anchored above the trigger —
 *      recomputed on open/trigger change),
 *    - document-level outside-click dismiss (active only while open),
 *    - Escape-key dismiss (same).
 *
 *  Dismiss is delivered via `onDismiss`, never inside the hook — callers
 *  with controlled open state, derived open state, or internal open
 *  state all wire the same way. */

import { createEventListener } from "@solid-primitives/event-listener";
import { createEffect, createSignal, type JSX } from "solid-js";

export type AnchorSide =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

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
   *  `"bottom-end"` right-anchors to the trigger; `"top-start"` and
   *  `"top-end"` open upward (panel sits above the trigger). */
  anchor?: AnchorSide;
  /** Min panel width — used for viewport clamping on the left-anchored
   *  variants (`"bottom-start"` and `"top-start"`). Defaults to 0
   *  (no clamp). */
  panelMinWidth?: number;
  /** Gap between the trigger and the panel edge. Defaults to 4px.
   *  For `bottom-*` anchors the panel opens below the trigger; for `top-*`
   *  anchors the panel opens above — the offset is the gap in both cases. */
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
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  }>({});

  const updatePos = () => {
    const t = opts.triggerRef();
    if (!t) return;
    const r = t.getBoundingClientRect();
    const offset = opts.offset ?? 4;
    // Upward anchors set `bottom` in viewport coordinates so the panel's
    // bottom edge sits above the trigger without measuring panel height.
    if (opts.anchor === "top-end") {
      setPos({
        bottom: window.innerHeight - r.top + offset,
        right: window.innerWidth - r.right,
      });
      return;
    }
    if (opts.anchor === "bottom-end") {
      setPos({ top: r.bottom + offset, right: window.innerWidth - r.right });
      return;
    }
    // Left-anchored variants share the viewport clamp; the only
    // distinction is whether to anchor by the trigger's top edge
    // (`top-start`, upward) or bottom edge (`bottom-start`, downward).
    const minW = opts.panelMinWidth ?? 0;
    const maxLeft = window.innerWidth - minW - VIEWPORT_PAD;
    const left = Math.max(VIEWPORT_PAD, Math.min(r.left, maxLeft));
    if (opts.anchor === "top-start") {
      setPos({ bottom: window.innerHeight - r.top + offset, left });
      return;
    }
    setPos({ top: r.bottom + offset, left });
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
    const css: JSX.CSSProperties = {};
    if (p.top !== undefined) css.top = `${p.top}px`;
    if (p.bottom !== undefined) css.bottom = `${p.bottom}px`;
    if (p.left !== undefined) css.left = `${p.left}px`;
    if (p.right !== undefined) css.right = `${p.right}px`;
    return css;
  };

  return { panelRef, panelStyle };
}
