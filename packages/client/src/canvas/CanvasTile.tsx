/** Single tile on the canvas — separated so createDraggable gets its own
 *  reactive owner per tile (required by solid-dnd). Shell only: positioning,
 *  title bar, resize handles. Content is injected via render props — the
 *  canvas module has no knowledge of what renders inside a tile.
 *
 *  Two display modes:
 *  - **Tiled** (default): absolute-positioned at the saved canvas layout,
 *    draggable + resizable, transform follows canvas pan/zoom.
 *  - **Maximized**: fixed inset-0 covering the canvas viewport. Drag/resize
 *    disabled. The maximize signal lives in `TerminalCanvas`, exposed here
 *    so chrome reflects state and double-click toggles it. */

import { type Component, For, type JSX, Show } from "solid-js";
import { createDraggable } from "@thisbeyond/solid-dnd";
import type { TileLayout } from "./TileLayout";
import { RESIZE_HANDLES, type ResizeDirection } from "./resizeGeometry";

/** Minimal theme info for tile chrome (title bar, border). */
export interface TileTheme {
  bg: string;
  fg: string;
}

// 800×540 fits ~88 cols × 27 rows at the default font (~9px × 20px cell),
// safely above the legacy 80×24 baseline that downstream tools (`stty`,
// `$COLUMNS`, less, vim) treat as the floor.
const DEFAULT_W = 800;
const DEFAULT_H = 540;

const CanvasTile: Component<{
  id: string;
  active: boolean;
  /** When true, the tile fills the canvas viewport (fixed inset-0) and
   *  drag/resize are disabled. Toggled by double-clicking the title bar. */
  maximized: boolean;
  /** "active" if the terminal emitted output recently, "sleeping" otherwise.
   *  Drives the data-activity attribute that e2e + UI states key off (the
   *  pre-#622 sidebar exposed this; tests still reach for it). */
  activity?: "active" | "sleeping";
  theme: TileTheme;
  onSelect: () => void;
  onClose: () => void;
  /** Toggle between tiled and maximized. Bound to title-bar double-click. */
  onToggleMaximize: () => void;
  renderTitle: () => JSX.Element;
  /** Optional actions rendered in the title bar between the title and the
   *  close button. For domain-specific, tile-type-variable capabilities
   *  (e.g. terminal screenshot, theme pill). Structural actions (close) are
   *  hardcoded. */
  renderTitleActions?: () => JSX.Element;
  renderBody: () => JSX.Element;
  layouts: Record<string, TileLayout>;
  startResize: (
    id: string,
    direction: ResizeDirection,
    e: PointerEvent,
  ) => void;
  zoom: () => number;
}> = (props) => {
  const { id } = props;
  const draggable = createDraggable(id);
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

  const bg = () => props.theme.bg;
  const fg = () => props.theme.fg;

  // While maximized: ignore drag transform and pin to viewport. While
  // tiled: absolute-positioned at layout(), drag transform follows.
  const tiledStyle = () => ({
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
  });

  return (
    <div
      ref={draggable.ref}
      data-testid="canvas-tile"
      data-terminal-id={id}
      data-active={props.active ? "true" : undefined}
      data-maximized={props.maximized ? "true" : undefined}
      data-activity={props.activity}
      class="flex flex-col rounded-xl overflow-hidden border transition-shadow duration-200"
      classList={{
        absolute: !props.maximized,
        "fixed inset-0 z-40 rounded-none": props.maximized,
        "border-accent/60 shadow-xl": props.active && !props.maximized,
        "border-edge/40 hover:border-edge/60":
          !props.active && !props.maximized,
        "border-transparent": props.maximized,
      }}
      style={props.maximized ? { "background-color": bg() } : tiledStyle()}
      onMouseDown={() => props.onSelect()}
    >
      {/* Title bar — uses tile foreground at low opacity for guaranteed
       *  contrast against the tile background, regardless of theme. The
       *  drag activators only attach when tiled — a maximized tile shouldn't
       *  start a drag on grab. Double-click toggles maximize. */}
      <div
        data-testid="canvas-tile-titlebar"
        class="flex items-center gap-2 px-3 py-1.5 shrink-0 select-none"
        classList={{
          "cursor-grab active:cursor-grabbing": !props.maximized,
        }}
        style={{
          "background-color": `color-mix(in oklch, ${fg()} 8%, ${bg()})`,
          "border-bottom": `1px solid color-mix(in oklch, ${fg()} 12%, ${bg()})`,
          // Scope theme-derived foreground tiers to the title bar so
          // chrome buttons read sensible defaults via var(--color-fg-3,
          // currentColor) without leaking the override into the tile body
          // (xterm + search overlays use the global tiers there).
          "--color-fg": fg(),
          "--color-fg-2": `color-mix(in oklch, ${fg()} 75%, ${bg()})`,
          "--color-fg-3": `color-mix(in oklch, ${fg()} 55%, ${bg()})`,
        }}
        onDblClick={(e) => {
          e.stopPropagation();
          props.onToggleMaximize();
        }}
        {...(props.maximized ? {} : draggable.dragActivators)}
      >
        {/* Traffic-lights — purely decorative (close already lives at the
         *  end of the bar, drag is the whole title bar). Hidden on maximized
         *  tiles to keep the chrome lean. */}
        <Show when={!props.maximized}>
          <div
            class="flex items-center gap-1 shrink-0 pointer-events-none"
            aria-hidden="true"
          >
            <span class="w-2.5 h-2.5 rounded-full bg-[#ff5f57]/80" />
            <span class="w-2.5 h-2.5 rounded-full bg-[#febc2e]/80" />
            <span class="w-2.5 h-2.5 rounded-full bg-[#28c840]/80" />
          </div>
        </Show>
        <div class="flex-1 min-w-0">{props.renderTitle()}</div>
        {props.renderTitleActions?.()}
        <button
          data-testid="canvas-tile-close"
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

      {/* Resize handles — 4 edges + 4 corners. Invisible; cursor change is the
       *  affordance. Corners are declared after edges in the record so DOM
       *  order paints them on top of the edge strips they overlap. Disabled
       *  while maximized — there's nothing to resize against. */}
      <Show when={!props.maximized}>
        <For each={Object.entries(RESIZE_HANDLES)}>
          {([direction, handle]) => (
            <div
              class={`absolute ${handle.position} ${handle.cursor}`}
              onPointerDown={(e) =>
                props.startResize(id, direction as ResizeDirection, e)
              }
            />
          )}
        </For>
      </Show>
    </div>
  );
};

export default CanvasTile;
