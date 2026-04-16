/** Single tile on the canvas — separated so createDraggable gets its own
 *  reactive owner per tile (required by solid-dnd). Shell only: positioning,
 *  title bar, resize handle. Content is injected via render props — the
 *  canvas module has no knowledge of what renders inside a tile. */

import type { Component, JSX } from "solid-js";
import { createDraggable } from "@thisbeyond/solid-dnd";
import { ResizeGripIcon } from "../ui/Icons";
import type { TileLayout } from "./useCanvasLayouts";

/** Minimal theme info for tile chrome (title bar, border, resize handle). */
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
  renderBody: () => JSX.Element;
  layouts: Record<string, TileLayout>;
  startResize: (id: string, e: PointerEvent) => void;
  zoom: () => number;
}> = (props) => {
  const { id } = props;
  const draggable = createDraggable(id);
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

  const bg = () => props.theme.bg;
  const fg = () => props.theme.fg;

  return (
    <div
      ref={draggable.ref}
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
        transform: `translate(${draggable.transform.x / props.zoom()}px, ${draggable.transform.y / props.zoom()}px)`,
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
        {...draggable.dragActivators}
      >
        <div class="flex-1 min-w-0">{props.renderTitle()}</div>
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
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Tile body — injected by caller */}
      {props.renderBody()}

      {/* Resize handle — bottom-right corner, larger hit area */}
      <div
        class="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize opacity-0 hover:opacity-100 transition-opacity"
        onPointerDown={(e) => props.startResize(id, e)}
      >
        <span
          class="absolute bottom-0.5 right-0.5"
          style={{
            color: `color-mix(in oklch, ${fg()} 40%, ${bg()})`,
          }}
        >
          <ResizeGripIcon />
        </span>
      </div>
    </div>
  );
};

export default CanvasTile;
