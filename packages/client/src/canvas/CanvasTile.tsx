/** Single tile on the canvas — separated so createDraggable gets its own
 *  reactive owner per tile (required by solid-dnd). Shell only: positioning,
 *  title bar, resize handles. Content is injected via render props — the
 *  canvas module has no knowledge of what renders inside a tile.
 *
 *  Two display modes:
 *  - **Tiled** (default): absolute-positioned at the saved canvas layout,
 *    draggable + resizable. Pan/zoom is composed into each tile's own
 *    `transform` rather than a shared wrapper, so the maximized branch can
 *    sit as a sibling without remounting on every active-id change (#988).
 *  - **Maximized**: `inset-0 z-40` covering the canvas viewport. Drag/resize
 *    disabled. The maximize signal lives in `TerminalCanvas`, exposed here
 *    so chrome reflects state and double-click toggles it. */

import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "@kolu/canvas-layout";
import { tileTransformCSS } from "@kolu/solid-canvas-viewport";
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

export type { TileTheme };

/** Per-tile render mode — one tile is in `"maximized"` (fills the viewport,
 *  drag/resize disabled), all others are in `"covered"` when the canvas is
 *  maximized (mounted, streaming, but visually behind the z-40 cover and
 *  hidden from assistive tech), or `"tiled"` when the canvas is not
 *  maximized (normal pan/zoom rendering). Unifying these into one union
 *  makes the impossible state `maximized && covered` unrepresentable. */
export type CanvasTileMode = "tiled" | "maximized" | "covered";

const CanvasTile: Component<{
  id: string;
  active: boolean;
  /** Per-tile render mode. Derived in `TerminalCanvas` from the canvas-wide
   *  posture (`useViewPosture`) and `activeId`. */
  mode: CanvasTileMode;
  /** Presentational hint — when true and the tile is not active, render
   *  faded so an inactive ("parked") tile recedes visually. The decision
   *  itself lives in the caller; the tile shell only honors the bit. */
  dimmed?: boolean;
  theme: TileTheme;
  /** Per-repo identity color; drives the tile border. */
  repoColor: string;
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
  /** Canvas viewport pan/zoom — composed into the tile's own transform so
   *  pan/zoom changes scale & translate this tile in screen-space without
   *  a wrapper transform. `left/top` stay set to the canvas-space layout
   *  so test selectors and tools that read tile positions keep working. */
  panX: () => number;
  panY: () => number;
  zoom: () => number;
}> = (props) => {
  const isMaximized = () => props.mode === "maximized";
  const isCovered = () => props.mode === "covered";
  const { id } = props;
  const draggable = createDraggable(id);
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };

  const bg = () => props.theme.bg;

  // Active stays full-strength regardless of dimmed — the user is looking
  // right at it. Inactive defaults to 0.92; dimmed inactive drops to 0.55
  // so a parked tile recedes without disappearing.
  const inactiveOpacity = () => (props.dimmed ? 0.55 : 0.92);

  // While maximized: ignore drag transform and pin to viewport. While
  // tiled: absolute-positioned at layout(), with pan/zoom and drag delta
  // composed into the tile's own transform so the pan/zoom wrapper that
  // used to host all tiles can go away (its containing-block side-effect
  // forced the maximized tile into a sibling render branch — see #988).
  // Transform formula lives in `coordinates.ts` alongside `canvasTransformCSS`
  // so pan/zoom math stays in one file.
  const tiledStyle = () => {
    const l = layout();
    return {
      left: `${l.x}px`,
      top: `${l.y}px`,
      width: `${l.w}px`,
      height: `${l.h}px`,
      "background-color": bg(),
      "border-color": props.repoColor,
      // Active tile's right edge points at the inspector panel — repoColor
      // on the other three edges, accent on the right. Longhand wins after
      // shorthand in the same declaration block.
      "border-right-color":
        props.active && !isMaximized()
          ? "var(--color-accent)"
          : props.repoColor,
      "z-index": props.active ? 10 : 1,
      opacity: props.active ? 1 : inactiveOpacity(),
      "box-shadow": props.active
        ? `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--color-accent)`
        : `0 2px 8px rgba(0,0,0,0.2)`,
      "transform-origin": "0 0",
      transform: tileTransformCSS(
        l.x,
        l.y,
        props.panX(),
        props.panY(),
        props.zoom(),
        draggable.transform.x,
        draggable.transform.y,
      ),
    };
  };

  return (
    <div
      ref={draggable.ref}
      data-testid="canvas-tile"
      data-canvas-tile=""
      data-terminal-id={id}
      data-active={props.active ? "true" : undefined}
      data-maximized={isMaximized() ? "true" : undefined}
      data-dimmed={props.dimmed ? "true" : undefined}
      // `inert` (when covered) removes the subtree from tab order, blocks
      // pointer events, and hides from assistive tech in one go — matches
      // the pre-#988 `visibility: hidden` wrapper without re-introducing
      // it. xterm.js writes still land in the buffer (no render dependency
      // on inert), so the dock's buffer previews stay populated.
      inert={isCovered()}
      aria-hidden={isCovered() ? "true" : undefined}
      class="flex flex-col overflow-hidden border transition-shadow duration-200"
      classList={{
        // Maximized uses `absolute inset-0 z-40` to cover the canvas
        // container. Since #988 dropped the pan/zoom wrapper div, the
        // nearest positioned ancestor is `canvas-grid-bg` (real viewport
        // rect, untransformed), so `inset-0` resolves cleanly to the
        // canvas's screen-space without any inverse-transform tricks.
        // The dock sits outside this container as a flex sibling in
        // maximized posture (TerminalCanvas), so the tile naturally
        // fills the remaining viewport without needing a left-inset (#904).
        absolute: true,
        "inset-0 z-40": isMaximized(),
        "rounded-xl": !isMaximized(),
        "shadow-xl": props.active && !isMaximized(),
        "border-transparent": isMaximized(),
      }}
      style={isMaximized() ? { "background-color": bg() } : tiledStyle()}
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
          "cursor-grab active:cursor-grabbing": !isMaximized(),
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
        {...(props.mode === "tiled" ? draggable.dragActivators : {})}
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
            title={isMaximized() ? "Restore to canvas" : "Maximize"}
          >
            <Show when={isMaximized()} fallback={<MaximizeIcon />}>
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
       *  order paints them on top of the edge strips they overlap. Only in
       *  `tiled` mode — maximized has nothing to resize against, covered tiles
       *  are inert and should not have interactive handles in the DOM. */}
      <Show when={props.mode === "tiled"}>
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
