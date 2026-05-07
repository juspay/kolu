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
import { type Component, createMemo, For, type JSX, Show } from "solid-js";
import type { AgentBucket } from "../agent/agentPresentation";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { MaximizeIcon, RestoreIcon } from "../ui/Icons";
import { RESIZE_HANDLES, type ResizeDirection } from "./resizeGeometry";
import { tileBorderEncoding } from "./tileBorderEncoding";
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
  /** Agent-state bucket — drives the outer ring channel of the border. */
  bucket: AgentBucket;
  /** Per-terminal repo accent — drives the inset focus glow. */
  cardColor: string;
  /** Pulsing alert dot when the terminal has caught the user's attention
   *  (e.g. agent transitioned to waiting and the user hasn't acknowledged). */
  unread: boolean;
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

  // Outer ring (agent state) + inset glow (focus) come from the encoding
  // helper. Drop shadow stays here as a pure depth cue — it does not carry
  // colour, so it can't compete with the bucket ring. Memoized so a drag
  // tick (60Hz) doesn't rebuild the class string + style object when only
  // the transform changes.
  const encoding = createMemo(() =>
    tileBorderEncoding({
      active: props.active,
      maximized: props.maximized,
      bucket: props.bucket,
      cardColor: props.cardColor,
    }),
  );

  // One style builder for both display modes — maximized fills the
  // viewport via `absolute inset-0` (set in classList), so it skips the
  // layout/transform fields. Both modes share background + encoding vars.
  const tileStyle = () => {
    const base = { "background-color": bg(), ...encoding().style };
    if (props.maximized) return base;
    return {
      ...base,
      left: `${layout().x}px`,
      top: `${layout().y}px`,
      width: `${layout().w}px`,
      height: `${layout().h}px`,
      "z-index": props.active ? 10 : 1,
      opacity: props.active ? 1 : 0.92,
      "box-shadow": props.active
        ? "0 8px 32px rgba(0,0,0,0.4)"
        : "0 2px 8px rgba(0,0,0,0.2)",
      // Drag transform is screen-space — divide by zoom so the tile
      // moves at the correct rate in the scaled canvas coordinate system.
      transform: `translate(${draggable.transform.x / props.zoom()}px, ${draggable.transform.y / props.zoom()}px)`,
    };
  };

  return (
    <div
      ref={draggable.ref}
      data-testid="canvas-tile"
      data-terminal-id={id}
      data-active={props.active ? "true" : undefined}
      data-maximized={props.maximized ? "true" : undefined}
      data-agent-bucket={props.bucket}
      data-unread={props.unread ? "true" : undefined}
      class={`flex flex-col overflow-hidden transition-shadow duration-200 ${encoding().class}`}
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
      }}
      style={tileStyle()}
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
        <Show when={props.unread}>
          <span
            data-testid="canvas-tile-alert"
            class="relative inline-flex h-2 w-2 mt-1.5 shrink-0"
            aria-hidden="true"
          >
            <span class="absolute inline-flex h-full w-full rounded-full bg-alert opacity-75 animate-ping" />
            <span class="relative inline-flex rounded-full h-2 w-2 bg-alert" />
          </span>
        </Show>
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
