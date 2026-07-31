/** Single tile on the canvas — separated so createDraggable gets its own
 *  reactive owner per tile (required by solid-dnd). Shell only: positioning,
 *  title bar, resize handles. Content is injected via render props — the
 *  canvas module has no knowledge of what renders inside a tile.
 *
 *  ONE display mode: absolute-positioned at its canvas layout, draggable and
 *  resizable, with pan/zoom composed into the tile's own `transform` rather
 *  than a shared wrapper (#988). There is no maximized/covered branch — the
 *  camera focuses a tile instead of the tile taking over the viewport, so a
 *  tile's geometry never changes with what the user is looking at. */

import { createDraggable } from "@thisbeyond/solid-dnd";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onMount,
  Show,
} from "solid-js";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { MaximizeIcon, RestoreIcon } from "../ui/Icons";
import {
  Z_CANVAS_TILE_ACTIVE,
  Z_CANVAS_TILE_INACTIVE,
} from "../ui/stackLayers";
import { RESIZE_HANDLES, type ResizeDirection } from "./resizeGeometry";
import type { TileLayout } from "./TileLayout";
import type { TileAura } from "./tileAura";
import {
  type TileTheme,
  tileChromeButton,
  tileFgTier,
  tileTitleBarBg,
  tileTitleBarBorder,
} from "./tileChrome";
import { DEFAULT_TILE_H, DEFAULT_TILE_W } from "./tilePlacement";
import { prefersReducedMotion } from "./viewport/animatedCamera";
import { tileTransformCSS } from "./viewport/coordinates";

export type { TileTheme };

const CanvasTile: Component<{
  id: string;
  active: boolean;
  /** Is the camera currently held on this tile? Purely a chrome cue — the
   *  tile's geometry is identical either way, because focusing moves the
   *  CAMERA rather than the tile (there is no maximized mode). */
  focused?: boolean;
  /** Presentational hint — when true and the tile is not active, render
   *  faded so an inactive ("parked") tile recedes visually. The decision
   *  itself lives in the caller; the tile shell only honors the bit. */
  dimmed?: boolean;
  /** Sleeping tile — desaturate / fold on the canvas so dormancy reads as
   *  a place change, not only a title-bar opacity. Caller owns the fact. */
  sleeping?: boolean;
  theme: TileTheme;
  /** Per-repo identity color; drives the tile border. */
  repoColor: string;
  onSelect: () => void;
  onClose: () => void;
  /** Hold the camera on this tile, or release it. Bound to the title-bar
   *  double-click and the focus button. */
  onToggleFocus: () => void;
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
  const isFocused = () => props.focused === true;
  const { id } = props;
  const draggable = createDraggable(id);
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_TILE_W, h: DEFAULT_TILE_H };

  // One-shot "tile lands on the plane" — armed only once on mount when the
  // tile is already tiled + awake + motion-ok. Any cancel path (maximize,
  // sleep, reduced-motion, animationend/cancel) spends the cue for this
  // shell instance (not re-armed without remount).
  const [landing, setLanding] = createSignal(false);
  const spendLanding = () => setLanding(false);
  onMount(() => {
    if (prefersReducedMotion() || props.sleeping) return;
    setLanding(true);
  });
  createEffect(() => {
    // Mid-entrance loss of eligibility cancels CSS without animationend —
    // spend so a later restore/wake never re-plays.
    if (!landing()) return;
    if (props.sleeping || prefersReducedMotion()) {
      spendLanding();
    }
  });
  const onLandInAnim: JSX.EventHandlerUnion<HTMLDivElement, AnimationEvent> = (
    e,
  ) => {
    if (e.target === e.currentTarget && e.animationName === "tile-place-in") {
      spendLanding();
    }
  };

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
  // and the `.tile-aura` child can't drift. An off-screen tile is gated out:
  // none should burn a frame animating a border nobody can see.
  const showAura = createMemo(() => aura() !== "none" && onScreen());

  // One-shot finished **exhale** — armed only when the tier *transitions*
  // into finished while the motion is observable. Any cancel (off-screen
  // Show gate, active mute, reduced motion, leave finished) spends it so
  // a later re-show of `.tile-aura` on the same shell never re-plays.
  // Held ring stays on `data-aura="finished"` alone.
  const [exhale, setExhale] = createSignal(false);
  let prevAura: TileAura = "none";
  createEffect(() => {
    const next = aura();
    const enteredFinished = next === "finished" && prevAura !== "finished";
    const eligible =
      showAura() && props.active !== true && !prefersReducedMotion();
    if (enteredFinished) {
      setExhale(eligible);
    } else if (next !== "finished" || !eligible) {
      setExhale(false);
    }
    prevAura = next;
  });
  const onAuraAnim: JSX.EventHandlerUnion<HTMLDivElement, AnimationEvent> = (
    e,
  ) => {
    if (e.animationName === "tile-aura-exhale") setExhale(false);
  };

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
      // signal is a crisp repo-colour OUTLINE floating in the moat (`--tile-moat-*`
      // tokens, shared with the working outer rail in index.css). Drawn outside
      // the border-box on the constant dark canvas — never over the terminal
      // body — and not clipped (outer shell is overflow-visible; title/body clip
      // via the inner shell). `--aura-c` is inherited by `.tile-aura`.
      "border-color": props.repoColor,
      "--aura-c": props.repoColor,
      "z-index": props.active ? Z_CANVAS_TILE_ACTIVE : Z_CANVAS_TILE_INACTIVE,
      opacity: props.active ? 1 : inactiveOpacity(),
      "box-shadow": props.active
        ? `0 8px 32px rgba(0,0,0,0.4)`
        : `0 2px 8px rgba(0,0,0,0.2)`,
      outline: props.active
        ? `var(--tile-moat-stroke) solid ${props.repoColor}`
        : undefined,
      "outline-offset": props.active ? "var(--tile-moat-offset)" : undefined,
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

  // A tile has exactly ONE geometry: absolute-positioned at its layout, with
  // pan/zoom and any drag delta composed into its own transform. The old
  // three-way switch (tiled / maximized / covered) is gone with maximized
  // mode — focusing a tile now moves the CAMERA, so no tile ever swaps to a
  // full-viewport box, nothing is ever covered, and the invariants that used
  // to tie those two boxes together (equal size so switching didn't refit
  // xterm; intrinsic `visibility: hidden` so a covered tile couldn't flash)
  // have nothing left to protect. A tile that is off-camera is simply
  // off-camera, exactly like a tile panned out of view has always been.

  return (
    <div
      ref={draggable.ref}
      data-testid="canvas-tile"
      data-canvas-tile=""
      data-terminal-id={id}
      data-active={props.active ? "" : undefined}
      data-focused={isFocused() ? "true" : undefined}
      data-dimmed={props.dimmed ? "true" : undefined}
      data-sleeping={props.sleeping ? "" : undefined}
      data-landing={
        landing() && !props.sleeping ? "" : undefined
      }
      data-exhale={
        exhale() && showAura() && aura() === "finished" ? "" : undefined
      }
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
      // Clip model is tier-independent: outer shell always overflow-visible so
      // outside-paint auras (working outer rail, future rings) are free; the
      // inner shell always clips title/body. Geometry does not branch on aura.
      class="relative border transition-shadow duration-200 overflow-visible"
      // One box, always: geometry and layer live in `tiledStyle()`; the
      // classList carries only decoration.
      classList={{ "rounded-xl": true }}
      style={tiledStyle()}
      onMouseDown={(event) => {
        // A live terminal owns the more precise pane landing (main vs split).
        // Letting this shell-level tile selection run afterward would resolve
        // the remembered visible split and overwrite an explicit main-pane
        // click. Chrome and empty tile space still select through this path.
        const target = event.target;
        if (
          target instanceof Element &&
          target.closest("[data-visible][data-terminal-id]")
        )
          return;
        props.onSelect();
      }}
      onAnimationEnd={onLandInAnim}
      onAnimationCancel={onLandInAnim}
    >
      {/* Clip shell — sole clip boundary for title/body (xterm, chrome). */}
      <div class="absolute inset-0 flex flex-col overflow-hidden rounded-[inherit]">
        {/* Title bar — uses tile foreground at low opacity for guaranteed
         *  contrast against the tile background, regardless of theme. The
         *  drag activators only attach when tiled — a maximized tile shouldn't
         *  start a drag on grab. Double-click toggles maximize.
         *
         *  Layout is a 2-column grid: `minmax(0,1fr)` for the identity block,
         *  `auto` for the action cluster. `items-start` hugs the actions to the
         *  top edge. `renderTitle()` is spread across the grid via
         *  `display:contents`, so `TerminalMeta`'s name row lands in column 1
         *  of row 1 (beside the actions) while its branch/PR row spans BOTH
         *  columns of row 2 — flowing full-width *under* the top-aligned
         *  actions instead of being boxed into the narrow left column. Without
         *  the span, the branch/PR row truncated early with dead space beneath
         *  a wide action cluster (agent status + theme + icons). */}
        <div
          data-testid="canvas-tile-titlebar"
          class="grid [grid-template-columns:minmax(0,1fr)_auto] items-start gap-x-2 px-3 py-1.5 shrink-0 select-none border-l-4"
          classList={{
            "cursor-grab active:cursor-grabbing": !isFocused(),
          }}
          style={{
            "background-color": tileTitleBarBg(props.theme),
            "border-bottom": `1px solid ${tileTitleBarBorder(props.theme)}`,
            "border-left-color": props.repoColor,
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
            props.onToggleFocus();
          }}
          {...draggable.dragActivators}
        >
          <div class="contents">{props.renderTitle()}</div>
          <div class="col-start-2 row-start-1 flex items-center gap-1 shrink-0">
            {props.renderTitleActions?.()}
            <button
              type="button"
              data-testid="canvas-tile-focus"
              class={`${CHROME_ICON_BUTTON_CLASS} pointer-events-auto hover:bg-black/20`}
              style={{
                color: tileChromeButton(props.theme),
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleFocus();
              }}
              title={isFocused() ? "Release focus (Esc)" : "Focus this tile"}
            >
              <Show when={isFocused()} fallback={<MaximizeIcon />}>
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
      </div>

      {/* Resize handles — 4 edges + 4 corners. Invisible; cursor change is the
       *  affordance. Corners are declared after edges in the record so DOM
       *  order paints them on top of the edge strips they overlap. Always
       *  present now: a tile has exactly one geometry, and focusing it moves
       *  the camera rather than replacing its box.
       *  Outside the clip shell so edge hit-targets aren't rounded away. */}
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

      {/* Language C · Run / sweep — agent run-state as MOTION in repo colour
       *  (`--aura-c`): working = double moat + rotating outer arc; needs-you =
       *  comet. Driven by `[data-aura]` in index.css. Outside the clip shell
       *  so the working outer rail can sit in the active-outline moat. */}
      <Show when={showAura()}>
        <div
          class="tile-aura tile-aura-ring"
          aria-hidden="true"
          onAnimationEnd={onAuraAnim}
          onAnimationCancel={onAuraAnim}
        />
      </Show>
    </div>
  );
};

export default CanvasTile;
