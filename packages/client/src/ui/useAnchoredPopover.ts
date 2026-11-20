/** Shared scaffold for a popover anchored to a trigger element: returns a
 *  `panelRef` callback and a reactive `panelStyle` accessor, owns
 *  viewport-clamped positioning, outside-click dismiss and Escape dismiss.
 *  Dismiss is delivered via `onDismiss`; the hook never mutates state. */

import { createEventListener } from "@solid-primitives/event-listener";
import { createEffect, createSignal, type JSX } from "solid-js";

export type AnchorSide =
  | "bottom-start"
  | "bottom-end"
  | "top-start"
  | "top-end";

export type UseAnchoredPopoverOpts = {
  /** Accessor for the trigger element; a signal-backed ref repositions. */
  triggerRef: () => HTMLElement | undefined;
  /** Accessor for current open state; document listeners attach only while
   *  this returns `true`. */
  open: () => boolean;
  /** Called on an outside click or Escape. */
  onDismiss: () => void;
  /** Defaults to `"bottom-start"`; `*-end` right-anchors, `top-*` opens
   *  upward. */
  anchor?: AnchorSide;
  /** Min panel width for the left-anchored clamp. Defaults to 0. */
  panelMinWidth?: number;
  /** Gap between the trigger and the panel edge. Defaults to 4px. */
  offset?: number;
  /** Flip a `bottom-*` anchor upward when the panel fits better above (and
   *  vice-versa). Off by default. */
  flip?: boolean;
  /** Treat a mousedown on this node as still "inside" the popover — for owned
   *  nested portals that live outside the panel DOM. */
  isInside?: (node: Node) => boolean;
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
    const minW = opts.panelMinWidth ?? 0;
    const maxLeft = window.innerWidth - minW - VIEWPORT_PAD;
    const left = Math.max(VIEWPORT_PAD, Math.min(r.left, maxLeft));
    const panelH = panelEl?.offsetHeight ?? 0;
    const roomBelow = window.innerHeight - r.bottom - offset - VIEWPORT_PAD;
    const roomAbove = r.top - offset - VIEWPORT_PAD;
    const flipUp =
      opts.flip === true &&
      opts.anchor !== "top-start" &&
      panelH > roomBelow &&
      roomAbove > roomBelow;
    if (opts.anchor === "top-start" || flipUp) {
      setPos({ bottom: window.innerHeight - r.top + offset, left });
      return;
    }
    setPos({ top: r.bottom + offset, left });
  };

  const docTarget = () => (opts.open() ? document : undefined);
  createEventListener(docTarget, "mousedown", (e) => {
    const node = e.target as Node;
    const t = opts.triggerRef();
    if (panelEl?.contains(node) || t?.contains(node)) return;
    if (opts.isInside?.(node)) return;
    opts.onDismiss();
  });
  createEventListener(docTarget, "keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    opts.onDismiss();
  });

  // Scroll is captured: scroll events do not bubble and the trigger may sit in
  // a scrolling panel.
  const winTarget = () => (opts.open() ? window : undefined);
  createEventListener(winTarget, "scroll", updatePos, {
    capture: true,
    passive: true,
  });
  createEventListener(winTarget, "resize", updatePos, { passive: true });

  createEffect(() => {
    if (opts.open() && opts.triggerRef()) updatePos();
  });

  const panelRef = (el: HTMLElement) => {
    panelEl = el;
    updatePos();
  };

  const panelStyle = (): JSX.CSSProperties => {
    const p = pos();
    // A Corvu modal layer sets `body { pointer-events: none }` and re-enables
    // them only on its own dialog content, so a body-level portal must
    // re-enable them here.
    const css: JSX.CSSProperties = {
      position: "fixed",
      "pointer-events": "auto",
    };
    if (p.top !== undefined) css.top = `${p.top}px`;
    if (p.bottom !== undefined) css.bottom = `${p.bottom}px`;
    if (p.left !== undefined) css.left = `${p.left}px`;
    if (p.right !== undefined) css.right = `${p.right}px`;
    return css;
  };

  return { panelRef, panelStyle };
}
