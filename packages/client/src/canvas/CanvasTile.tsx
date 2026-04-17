/** Single tile on the canvas — pure render. No inline event-handler closures
 *  are attached to its chrome: every handler defined inside the component
 *  body would share a V8 Context chain with component locals, pinning the
 *  whole scope past dispose. Instead, all pointer / click handling is
 *  delegated to `<TerminalCanvas>` via data attributes:
 *
 *    - `data-tile-id` on the wrapper identifies the tile
 *    - `data-drag-handle` on the title bar marks the drag zone
 *    - `data-resize-dir` on each resize handle marks the direction
 *    - `data-tile-action="select" | "close"` on interactive elements
 *
 *  Content is injected via render props — the canvas module has no
 *  knowledge of what renders inside a tile. */

import { type Component, For, type JSX } from "solid-js";
import type { TileLayout } from "./TileLayout";
import { RESIZE_HANDLES } from "./resizeGeometry";
import { dragOffsetFor } from "./dragState";

/** Minimal theme info for tile chrome (title bar, border). */
export interface TileTheme {
  bg: string;
  fg: string;
}

const DEFAULT_W = 700;
const DEFAULT_H = 500;

const CanvasTile: Component<{
  id: string;
  active: boolean;
  theme: TileTheme;
  renderTitle: () => JSX.Element;
  /** Optional actions rendered in the title bar between the title and the
   *  close button. For domain-specific, tile-type-variable capabilities
   *  (e.g. terminal screenshot). Structural actions (close) are hardcoded. */
  renderTitleActions?: () => JSX.Element;
  renderBody: () => JSX.Element;
  layouts: Record<string, TileLayout>;
  zoom: () => number;
}> = (props) => {
  const { id } = props;
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

  const bg = () => props.theme.bg;
  const fg = () => props.theme.fg;

  return (
    <div
      data-active={props.active ? "true" : undefined}
      data-tile-id={id}
      data-tile-action="select"
      class="absolute flex flex-col rounded-xl overflow-hidden border transition-shadow duration-200"
      classList={{
        "border-accent/60 shadow-xl": props.active,
        "border-edge/40 hover:border-edge/60": !props.active,
      }}
      style={{
        left: `${layout().x}px`,
        top: `${layout().y}px`,
        width: `${layout().w}px`,
        height: `${layout().h}px`,
        "background-color": bg(),
        "z-index": props.active ? 10 : 1,
        opacity: props.active ? 1 : 0.92,
        "box-shadow": props.active
          ? `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--color-accent)`
          : `0 2px 8px rgba(0,0,0,0.2)`,
        // Drag transform driven by the singleton `canvasDragState` signal
        // managed by TerminalCanvas. Screen-space delta divided by zoom so
        // the tile moves at the correct rate in the scaled canvas
        // coordinate system.
        transform: (() => {
          const d = dragOffsetFor(id);
          const z = props.zoom();
          return `translate(${d.x / z}px, ${d.y / z}px)`;
        })(),
      }}
    >
      {/* Title bar. `data-drag-handle` lets TerminalCanvas start a drag on
       *  pointerdown here. */}
      <div
        data-drag-handle
        class="flex items-center gap-2 px-3 py-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none"
        style={{
          "background-color": `color-mix(in oklch, ${fg()} 8%, ${bg()})`,
          "border-bottom": `1px solid color-mix(in oklch, ${fg()} 12%, ${bg()})`,
          "--color-fg": fg(),
          "--color-fg-2": `color-mix(in oklch, ${fg()} 75%, ${bg()})`,
          "--color-fg-3": `color-mix(in oklch, ${fg()} 55%, ${bg()})`,
        }}
      >
        <div class="flex-1 min-w-0">{props.renderTitle()}</div>
        {props.renderTitleActions?.()}
        <button
          data-tile-action="close"
          class="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm"
          style={{
            color: `color-mix(in oklch, ${fg()} 50%, ${bg()})`,
          }}
          title="Close terminal"
        >
          ×
        </button>
      </div>

      {/* Tile body — injected by caller */}
      {props.renderBody()}

      {/* Resize handles — 4 edges + 4 corners. Invisible; cursor change is
       *  the affordance. Corners are declared after edges in the record so
       *  DOM order paints them on top of the edge strips they overlap. */}
      <For each={Object.entries(RESIZE_HANDLES)}>
        {([direction, handle]) => (
          <div
            class={`absolute ${handle.position} ${handle.cursor}`}
            data-resize-dir={direction}
          />
        )}
      </For>
    </div>
  );
};

export default CanvasTile;
