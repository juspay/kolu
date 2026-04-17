/** Two-panel resizable splitter — minimal replacement for `@corvu/resizable`.
 *
 *  Motivation (#610 follow-up): `@corvu/resizable` retains ~30 SolidJS
 *  reactive contexts per mount/unmount cycle. With `<TerminalContent>`
 *  remounting on every canvas ↔ focus toggle, 6 terminals × 30 toggles
 *  leaked ~11k Context objects. Verified via heap-snapshot byte-delta
 *  diff: replacing `<Resizable>` with a plain `<div>` dropped the leak
 *  to near zero. This component is the drop-in replacement that owns
 *  its lifecycle end-to-end — no provider, no context propagation, no
 *  effect chains that outlive the component — so dispose is total.
 *
 *  Scope: exactly two panels + one handle. Mirrors Corvu's "sizes as
 *  fractions" API so callers migrate with minimal churn. Collapse /
 *  expand is caller-driven (we emit sizes; caller decides how to react).
 *  No drag-to-collapse auto-behaviour; if you need that, collapse via
 *  an explicit button (the "▾ Hide" UX already in place). */

import { type Component, type JSX, Show, onCleanup } from "solid-js";

export type Sizes = readonly [number, number];

/** Split axis. `vertical` stacks top+bottom; `horizontal` lays out left+right. */
export type SplitOrientation = "vertical" | "horizontal";

const Splitter: Component<{
  orientation: SplitOrientation;
  /** Current fractions. Must sum to ~1. Driven reactively by caller. */
  sizes: Sizes;
  /** Fired while the user drags the handle. */
  onSizesChange: (sizes: Sizes) => void;
  /** `[primaryMin, secondaryMin]` as fractions. Defaults to `[0, 0]`. */
  minSizes?: Sizes;
  class?: string;
  primary: JSX.Element;
  secondary: JSX.Element;
  primaryClass?: string;
  secondaryClass?: string;
  /** When false the handle is not rendered and the two panels sit flush. */
  showHandle: boolean;
  handleClass?: string;
  handleClassList?: Record<string, boolean | undefined>;
  handleTestId?: string;
  handleAriaLabel?: string;
}> = (props) => {
  let containerRef!: HTMLDivElement;
  let abortDrag: AbortController | null = null;

  // Covers the case where the user releases the mouse outside a window that
  // unmounts mid-drag (e.g. mode toggle while resizing).
  onCleanup(() => {
    abortDrag?.abort();
    // Clear any body style we set.
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  });

  function onHandlePointerDown(e: PointerEvent) {
    // Ignore non-primary buttons.
    if (e.button !== 0) return;
    e.preventDefault();
    abortDrag?.abort();
    const controller = new AbortController();
    abortDrag = controller;
    const { signal } = controller;

    const rect = containerRef.getBoundingClientRect();
    const span = props.orientation === "vertical" ? rect.height : rect.width;
    if (span <= 0) {
      controller.abort();
      return;
    }
    const origin = props.orientation === "vertical" ? rect.top : rect.left;
    const [minA, minB] = props.minSizes ?? [0, 0];

    // Lock the cursor and disable text selection during drag.
    document.body.style.userSelect = "none";
    document.body.style.cursor =
      props.orientation === "vertical" ? "row-resize" : "col-resize";

    const onMove = (ev: PointerEvent) => {
      const pos = props.orientation === "vertical" ? ev.clientY : ev.clientX;
      let frac = (pos - origin) / span;
      frac = Math.max(minA, Math.min(1 - minB, frac));
      props.onSizesChange([frac, 1 - frac]);
    };
    const endDrag = () => controller.abort();

    window.addEventListener("pointermove", onMove, { signal });
    window.addEventListener("pointerup", endDrag, { signal });
    window.addEventListener("pointercancel", endDrag, { signal });
    signal.addEventListener("abort", () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    });
  }

  return (
    <div
      ref={containerRef}
      class={`flex ${
        props.orientation === "vertical" ? "flex-col" : "flex-row"
      } ${props.class ?? ""}`}
    >
      <div
        class={props.primaryClass}
        style={{
          "flex-grow": props.sizes[0],
          "flex-shrink": 1,
          "flex-basis": "0",
        }}
      >
        {props.primary}
      </div>
      <Show when={props.showHandle}>
        <div
          data-testid={props.handleTestId}
          aria-label={props.handleAriaLabel}
          role="separator"
          aria-orientation={props.orientation}
          class={props.handleClass}
          classList={props.handleClassList}
          onPointerDown={onHandlePointerDown}
        />
      </Show>
      <div
        class={props.secondaryClass}
        style={{
          "flex-grow": props.sizes[1],
          "flex-shrink": 1,
          "flex-basis": "0",
        }}
      >
        {props.secondary}
      </div>
    </div>
  );
};

export default Splitter;
