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

import { createDraggable } from "@thisbeyond/solid-dnd";
import { type Component, createMemo, For, type JSX, Show } from "solid-js";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import {
  Z_CANVAS_TILE_ACTIVE,
  Z_CANVAS_TILE_INACTIVE,
} from "../ui/stackLayers";
import { MaximizeIcon, RestoreIcon } from "../ui/Icons";
import { RESIZE_HANDLES, type ResizeDirection } from "./resizeGeometry";
import type { TileAura } from "./tileAura";
import type { TileLayout } from "./TileLayout";
import {
  type TileTheme,
  tileChromeButton,
  tileFgTier,
  tileTitleBarBg,
  tileTitleBarBorder,
} from "./tileChrome";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import { tileTransformCSS } from "./viewport/coordinates";

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
  /** Canvas viewport size in screen pixels. Lets the tile gate its state-aura
   *  to on-screen tiles only: a tile panned out of view (or behind a maximized
   *  tile) mounts no `.tile-aura` at all, so its border animation costs nothing
   *  — CSS animations otherwise keep running for off-screen elements. */
  viewportSize: () => { width: number; height: number };
  /** Canvas state-aura tier for this tile — drives the `data-aura` hook the
   *  border treatment reads. Optional: undefined renders nothing (treated as
   *  `"none"`). Resolved by `useTileAura`; this resolver drives only the tile
   *  border. The minimap derives its own bucket→color independently via
   *  `bucketDescriptor` and does not share this tier. */
  auraTier?: () => TileAura;
}> = (props) => {
  const isMaximized = () => props.mode === "maximized";
  const isCovered = () => props.mode === "covered";
  const { id } = props;
  const draggable = createDraggable(id);
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };

  const bg = () => props.theme.bg;
  // Memoized: `showAura` and the `data-aura` attribute both read the tier, and
  // each read chains through the resolver into store + staleness lookups — so
  // compute it once per reactive cycle rather than per consumer.
  const aura = createMemo((): TileAura => props.auraTier?.() ?? "none");
  // Is this tile's screen rect within the canvas viewport (plus a margin so
  // panning doesn't pop auras in at the very edge)? Mirrors the screen-space
  // mapping in `tileTransformCSS`: a canvas point (l.x, l.y) lands at
  // ((l.x - panX) * zoom, (l.y - panY) * zoom). Drag delta is ignored — a tile
  // being dragged is on-screen by definition. Until the container has measured
  // (size 0), don't gate — show the aura rather than briefly hiding it.
  const onScreen = createMemo(() => {
    const { width, height } = props.viewportSize();
    if (width === 0 || height === 0) return true;
    const l = layout();
    const z = props.zoom();
    const sx = (l.x - props.panX()) * z;
    const sy = (l.y - props.panY()) * z;
    const m = 200;
    return (
      sx + l.w * z > -m &&
      sx < width + m &&
      sy + l.h * z > -m &&
      sy < height + m
    );
  });
  // One decision — "is the aura showing" — so the `data-aura` host attribute
  // and the `.tile-aura` child can't drift. Only TILED tiles animate: a
  // maximized tile mutes its own aura, a covered tile (behind a maximized
  // sibling) is hidden, and an off-screen tile is gated out — none should burn
  // a frame animating a border nobody can see.
  const showAura = createMemo(
    () => aura() !== "none" && props.mode === "tiled" && onScreen(),
  );

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
  const tiledStyle = (): JSX.CSSProperties => {
    const l = layout();
    return {
      position: "absolute",
      left: `${l.x}px`,
      top: `${l.y}px`,
      width: `${l.w}px`,
      height: `${l.h}px`,
      "background-color": bg(),
      // One colour throughout: the repo's identity colour drives the border, the
      // state aura, AND the active tile's focus cue. The active "you are here"
      // signal is a crisp repo-colour OUTLINE floating 4px off the tile on the
      // dark canvas (`outline` + `outline-offset` below). It's drawn outside the
      // border-box on the constant dark canvas — never over the terminal body,
      // so it's theme-independent — and `outline` is never clipped by the tile's
      // overflow-hidden. The 4px moat keeps it clear of the border aura.
      "border-color": props.repoColor,
      "z-index": props.active ? Z_CANVAS_TILE_ACTIVE : Z_CANVAS_TILE_INACTIVE,
      opacity: props.active ? 1 : inactiveOpacity(),
      "box-shadow": props.active
        ? `0 8px 32px rgba(0,0,0,0.4)`
        : `0 2px 8px rgba(0,0,0,0.2)`,
      outline: props.active ? `1.5px solid ${props.repoColor}` : undefined,
      "outline-offset": props.active ? "4px" : undefined,
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

  // Per-mode presentation: ONE switch on `props.mode` is the sole place that
  // decides geometry + layer + decoration + visibility, returning a complete,
  // self-sufficient box. `maximized` and `covered` literally reuse the same
  // `fullViewportBox` (`position: absolute; inset: 0`), so "covered shares the
  // maximized tile's box" is one source of truth a reader verifies at a glance
  // rather than an invariant assembled from `inset-0` (classList) agreeing with
  // a deliberately-geometry-less `style`. The style object alone is always a
  // legal box — no mode's geometry depends on a second structure firing in
  // lockstep. Two invariants ride on the maximized/covered equality:
  //
  //  - A covered tile hides INTRINSICALLY (`visibility: hidden`), not by relying
  //    on the maximized tile's `z-40` cover. During the window where `activeId`
  //    already points at a just-created tile that hasn't entered `terminalIds`
  //    yet, no maximized tile exists — a covered tile carrying only `inert`
  //    would paint, flashing the canvas for a frame (regressed in #989, which
  //    dropped the pre-#988 `visibility: hidden`). Keep the subtree mounted
  //    (`visibility`, not `display`) so xterm keeps writing its buffer and the
  //    dock previews stay populated (#904).
  //  - A covered tile is the SAME SIZE as the maximized tile (both are
  //    `fullViewportBox`). Switching the active terminal in maximized posture is
  //    then a pure visibility/z-index swap: no tile changes border-box size, so
  //    `Terminal`'s ResizeObserver never fires `fit()` — no xterm grid reflow,
  //    no repaint, and no server PTY resize on switch. (Were covered tiles sized
  //    to their small canvas-layout rect — as they are when `tiled` — every
  //    switch would resize BOTH the revealed and the hidden xterm and refit
  //    them: the per-switch "re-render".) Tradeoff: ENTERING maximized posture
  //    now sizes every covered tile's PTY to the viewport grid once — a one-time
  //    SIGWINCH per tile on the posture toggle, not a per-switch cost.
  const presentation = createMemo(
    (): {
      style: JSX.CSSProperties;
      classes: Record<string, boolean>;
    } => {
      // The full canvas viewport box, shared verbatim by maximized and covered so
      // their border-box is structurally identical. Since #988 dropped the
      // pan/zoom wrapper div, the nearest positioned ancestor is `canvas-grid-bg`
      // (real viewport rect, untransformed), so `inset: 0` resolves cleanly to the
      // canvas's screen-space without any inverse-transform tricks. The dock sits
      // outside this container as a flex sibling in maximized posture
      // (TerminalCanvas), so the tile naturally fills the remaining viewport
      // without needing a left-inset (#904).
      const fullViewportBox: JSX.CSSProperties = {
        position: "absolute",
        inset: 0,
        "background-color": bg(),
      };
      switch (props.mode) {
        case "maximized":
          // Only the maximized tile takes `z-40`, so it paints above its hidden
          // covered siblings.
          return {
            style: { ...fullViewportBox, "z-index": 40 },
            classes: { "border-transparent": true },
          };
        case "covered":
          return {
            style: { ...fullViewportBox, visibility: "hidden" },
            classes: { "border-transparent": true },
          };
        default:
          // Tiled: absolute-positioned at the saved canvas layout, with rounded
          // corners and a repo-colour border.
          return {
            style: tiledStyle(),
            classes: { "rounded-xl": true },
          };
      }
    },
  );

  return (
    <div
      ref={draggable.ref}
      data-testid="canvas-tile"
      data-canvas-tile=""
      data-terminal-id={id}
      data-active={props.active ? "true" : undefined}
      data-maximized={isMaximized() ? "true" : undefined}
      data-dimmed={props.dimmed ? "true" : undefined}
      data-aura={showAura() ? aura() : undefined}
      // `inert` (when covered) removes the subtree from tab order, blocks
      // pointer events, and hides from assistive tech in one go — matches
      // the pre-#988 `visibility: hidden` wrapper without re-introducing
      // it. xterm.js writes still land in the buffer (no render dependency
      // on inert), so the dock's buffer previews stay populated.
      //
      // Deliberately NOT pairing this with `aria-hidden="true"`: `inert`
      // already drops the subtree from the accessibility tree, so the
      // attribute is redundant — and the browser blocks `aria-hidden` on an
      // ancestor of a focused element (the xterm helper textarea can retain
      // DOM focus the instant a tile is covered), logging a WAI-ARIA console
      // warning. `inert` is the spec's recommended replacement precisely
      // because it hides *and* prevents focus without that conflict.
      inert={isCovered()}
      class="flex flex-col overflow-hidden border transition-shadow duration-200"
      // Geometry, layer, and visibility all live in `presentation().style` (one
      // complete box per mode); the classList carries only non-geometric,
      // mode-specific decoration (rounded corners vs. transparent border).
      classList={{ ...presentation().classes }}
      style={presentation().style}
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

      {/* Language C · Run / sweep — agent run-state shown as MOTION on a border
       *  ring in the repo's identity colour (`--aura-c` = repoColor, the one
       *  colour used throughout): working "runs" as marching ants, needs-you
       *  "sweeps" a comet whose speed is the urgency. The treatment + speed are
       *  driven by `[data-aura]` rules in index.css. Last child so it paints
       *  over the body; `pointer-events:none` so it never eats a click. Skipped
       *  when maximized — the focused tile mutes its own aura. */}
      <Show when={showAura()}>
        <div
          class="tile-aura"
          aria-hidden="true"
          style={{ "--aura-c": props.repoColor }}
        />
      </Show>
    </div>
  );
};

export default CanvasTile;
