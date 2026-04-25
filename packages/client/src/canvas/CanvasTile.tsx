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

import { createDraggable } from "@thisbeyond/solid-dnd";
import { type Component, For, type JSX, Show } from "solid-js";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { MaximizeIcon, RestoreIcon } from "../ui/Icons";
import { RESIZE_HANDLES, type ResizeDirection } from "./resizeGeometry";
import type { TileLayout } from "./TileLayout";
import {
  type TileTheme,
  tileChromeButton,
  tileFgTier,
  tileTitleBarBg,
  tileTitleBarBorder,
} from "./tileChrome";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";

export type { TileTheme };

const CanvasTile: Component<{
  id: string;
  active: boolean;
  /** When true, the tile fills the canvas viewport (fixed inset-0) and
   *  drag/resize are disabled. Toggled by double-clicking the title bar. */
  maximized: boolean;
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
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };

  const bg = () => props.theme.bg;

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
      class="flex flex-col overflow-hidden border transition-shadow duration-200"
      classList={{
        // Maximized stays `absolute inset-0` so it fills the canvas
        // container — NOT `fixed`, because the transformed pan/zoom
        // wrapper would otherwise become its containing block (CSS
        // makes `position: fixed` resolve to the nearest transformed
        // ancestor, not the viewport). Caller must render maximized
        // tiles outside that wrapper. Rounding is gated on the same
        // axis: a maximized tile butts edge-to-edge against the canvas
        // container, so rounded corners would leave a grid-bg sliver.
        absolute: true,
        "inset-0 z-40": props.maximized,
        "rounded-xl": !props.maximized,
        "border-accent/60 shadow-xl": props.active && !props.maximized,
        // Active-tile right edge is the visual handshake to the right
        // panel (the panel inspects this tile). The other three edges
        // stay at accent/60 via the rule above; this overrides only the
        // right edge to full accent so the cue reads asymmetrically as
        // "this side points at the inspector." Sits in classList rather
        // than tiledStyle() so it isn't re-evaluated on every drag tick.
        "border-r-[var(--color-accent)]": props.active && !props.maximized,
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
       *  start a drag on grab. Double-click toggles maximize.
       *
       *  Layout is `items-start` so window controls hug the top edge even
       *  when the title block grows multi-row (branch + PR + agent rows).
       *  Title actions are wrapped in a top-aligned cluster so split /
       *  search / screenshot / maximize / close all sit on row 1, and the
       *  identity rows stack below the name. */}
      <div
        data-testid="canvas-tile-titlebar"
        class="flex items-start gap-2 px-3 py-1.5 shrink-0 select-none"
        classList={{
          "cursor-grab active:cursor-grabbing": !props.maximized,
        }}
        style={{
          "background-color": tileTitleBarBg(props.theme),
          "border-bottom": `1px solid ${tileTitleBarBorder(props.theme)}`,
          // Scope theme-derived foreground tiers to the title bar so
          // chrome buttons read sensible defaults via var(--color-fg-3,
          // currentColor) without leaking the override into the tile body
          // (xterm + search overlays use the global tiers there).
          "--color-fg": tileFgTier(props.theme, 1),
          "--color-fg-2": tileFgTier(props.theme, 2),
          "--color-fg-3": tileFgTier(props.theme, 3),
        }}
        // Non-interactive chrome: prevent the browser's default
        // mousedown focus shift so clicks on the title bar don't blur
        // the xterm textarea. solid-dnd's drag uses pointerdown, not
        // mousedown, so drag is unaffected; child buttons handle their
        // own focus via stopPropagation on pointerdown.
        onMouseDown={(e) => e.preventDefault()}
        onDblClick={(e) => {
          e.stopPropagation();
          props.onToggleMaximize();
        }}
        {...(props.maximized ? {} : draggable.dragActivators)}
      >
        <div class="flex-1 min-w-0">{props.renderTitle()}</div>
        <div class="flex items-center gap-1 shrink-0">
          {props.renderTitleActions?.()}
          <button
            type="button"
            data-testid="canvas-tile-maximize"
            class={`${CHROME_ICON_BUTTON_CLASS} pointer-events-auto hover:bg-black/20`}
            style={{
              color: tileChromeButton(props.theme),
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleMaximize();
            }}
            title={props.maximized ? "Restore to canvas" : "Maximize"}
          >
            <Show when={props.maximized} fallback={<MaximizeIcon />}>
              <RestoreIcon />
            </Show>
          </button>
          <button
            type="button"
            data-testid="canvas-tile-close"
            class={`${CHROME_ICON_BUTTON_CLASS} pointer-events-auto text-sm`}
            style={{
              color: tileChromeButton(props.theme),
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
