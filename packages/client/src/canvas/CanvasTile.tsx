/** Single tile on the canvas — shell only: positioning, title bar, resize
 *  handles. Drag lifecycle is owned by `createDrag` (local pointer-based
 *  primitive) — each tile's reactive owner scopes the drag's onCleanup so
 *  in-flight drags abort on unmount. Content is injected via render props —
 *  the canvas module has no knowledge of what renders inside a tile. */

import { type Component, For, type JSX } from "solid-js";
import type { TileLayout } from "./TileLayout";
import { RESIZE_HANDLES } from "./resizeGeometry";
import { createDrag, type DragDelta } from "./createDrag";

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
  onSelect: () => void;
  onClose: () => void;
  renderTitle: () => JSX.Element;
  /** Optional actions rendered in the title bar between the title and the
   *  close button. For domain-specific, tile-type-variable capabilities
   *  (e.g. terminal screenshot). Structural actions (close) are hardcoded. */
  renderTitleActions?: () => JSX.Element;
  renderBody: () => JSX.Element;
  layouts: Record<string, TileLayout>;
  zoom: () => number;
  /** Fired continuously while the title bar is being dragged. Screen-space
   *  delta from pointer-down — caller normalizes by zoom. */
  onDragMove: (id: string, delta: DragDelta) => void;
  /** Fired once on pointerup. The final delta is passed so the caller
   *  can commit atomically. */
  onDragEnd: (id: string, delta: DragDelta) => void;
}> = (props) => {
  const { id } = props;
  const drag = createDrag({
    onMove: (delta) => props.onDragMove(id, delta),
    onEnd: (delta) => props.onDragEnd(id, delta),
  });
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

  const bg = () => props.theme.bg;
  const fg = () => props.theme.fg;

  return (
    <div
      data-active={props.active ? "true" : undefined}
      data-tile-id={id}
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
        // Drag transform is screen-space — divide by zoom so the tile
        // moves at the correct rate in the scaled canvas coordinate system.
        transform: `translate(${drag.transform().x / props.zoom()}px, ${drag.transform().y / props.zoom()}px)`,
      }}
      onMouseDown={() => props.onSelect()}
    >
      {/* Title bar — uses tile foreground at low opacity for guaranteed
       *  contrast against the tile background, regardless of theme. */}
      <div
        class="flex items-center gap-2 px-3 py-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none"
        style={{
          "background-color": `color-mix(in oklch, ${fg()} 8%, ${bg()})`,
          "border-bottom": `1px solid color-mix(in oklch, ${fg()} 12%, ${bg()})`,
          "--color-fg": fg(),
          "--color-fg-2": `color-mix(in oklch, ${fg()} 75%, ${bg()})`,
          "--color-fg-3": `color-mix(in oklch, ${fg()} 55%, ${bg()})`,
        }}
        {...drag.dragActivators}
      >
        <div class="flex-1 min-w-0">{props.renderTitle()}</div>
        {props.renderTitleActions?.()}
        <button
          class="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm"
          style={{
            color: `color-mix(in oklch, ${fg()} 50%, ${bg()})`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
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
       *  DOM order paints them on top of the edge strips they overlap.
       *  The onPointerDown handler lives on the parent <TerminalCanvas>
       *  (event delegation) so per-handle closures don't share a V8 Context
       *  chain with CanvasTile's component scope. Without this delegation,
       *  each disposed tile's resize-handle closure was pinning ~1,450
       *  Contexts per 30 toggles, verified via heap-snapshot byte-diff. */}
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
