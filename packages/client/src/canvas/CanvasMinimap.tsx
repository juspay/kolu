/** Canvas minimap — spatial overview of all tiles + integrated zoom controls. */

import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";
import { activeArm } from "kolu-common/surface";
import { formatTimeAgo, useStaleCheck } from "../terminal/staleness";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileStore } from "../tile/useTileStore";
import { ActivityWindowChip } from "../ui/ActivityWindowChip";
import { GridIcon } from "../ui/Icons";
import { agentBucket, bucketDescriptor } from "./dockModel";
import {
  handleMinimapClick,
  startTileDrag,
  startViewportDrag,
} from "./minimapGestures";
import type { TileLayout } from "./TileLayout";
import { useTileTheme } from "./useTileTheme";
import { useCanvasViewport } from "./viewport/useCanvasViewport";

/** Minimap target dimensions in pixels. */
const MAP_W = 180;
const MAP_H = 120;
/** Padding around tile bounding box in canvas-space units. */
const MAP_PAD = 100;
/** Diameter (px) of the ghost marker rendered for parked tiles when the
 *  user has hidden them. Big enough to click/drag without being visually
 *  loud. */
const GHOST_PX = 6;
/** Duration + easing for the morph between full rect and ghost. Shared by
 *  the tile and the bucket badge so the geometry change and the badge fade
 *  always run on the same clock. */
const MORPH_TRANSITION = "duration-300 ease-out";
/** Focused transition property list for the morphing tile. `transition-all`
 *  would force the browser to watch every animatable property — including
 *  hover-induced ring/shadow shifts and inherited color cascades — across
 *  every minimap tile on every reactive tick (pan, zoom, staleness check).
 *  Naming the four properties we actually animate lets the compositor
 *  short-circuit the rest. */
const TILE_TRANSITION_PROPS =
  "transition-[left,top,width,height,background-color,border-color,border-radius]";

/** Build the hover tooltip for a minimap tile. Closes #870: the previous
 *  `title={id}` showed the opaque terminal id; now it shows the same
 *  identity pair the workspace switcher uses (`repo · branch[ #suffix]`)
 *  plus the last-active duration. Multi-line via `\n` — supported in
 *  modern browsers' `title` attribute. */
function tileTooltip(info: TerminalDisplayInfo, parked: boolean): string {
  const { group, label, suffix } = info.key;
  const headParts: string[] = [group];
  if (label && label !== group) headParts.push(label);
  if (suffix) headParts.push(suffix);
  const head = headParts.join(" · ");
  const ago = formatTimeAgo(info.meta.lastActivityAt);
  const lines = [head];
  if (ago) lines.push(parked ? `Parked — last active ${ago}` : `Active ${ago}`);
  return lines.join("\n");
}

/** Icon button rendered in the right half of the minimap zoom bar — sits
 *  after the zoom controls behind a left divider. Today only used by the
 *  arrange button; the window-selector trigger renders compact text instead
 *  (matching the zoom-reset button style). */
const ZoomBarButton: Component<{
  testId: string;
  title: string;
  icon: JSX.Element;
  onClick: () => void;
}> = (props) => (
  <button
    type="button"
    data-testid={props.testId}
    class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer border-l border-edge/40"
    title={props.title}
    onClick={props.onClick}
  >
    {props.icon}
  </button>
);

const CanvasMinimap: Component<{
  tileIds: string[];
  layouts: Record<string, TileLayout>;
  /** Activate a tile (make it the focused terminal). */
  onSelect: (id: string) => void;
  onStartTileDrag: (id: string) => {
    preview: (dx: number, dy: number) => void;
    commit: (dx: number, dy: number) => void;
  } | null;
  /** Optional: trigger the arrange-by-repo command. When provided, the
   *  zoom bar grows an arrange button that fires this callback. Hidden
   *  for single-tile workspaces (a single-tile arrange is a visual no-op,
   *  same gate as the palette entry).
   *
   *  Why a prop and not `useCanvasArrange()` directly: arrange is a
   *  command wired once in App.tsx (it shares the palette/centering
   *  policy), so the canvas hands the minimap the already-bound
   *  `handleCanvasAutoArrange`. The prop keeps the minimap ignorant of
   *  the arrange policy itself. */
  onAutoArrange?: () => void;
}> = (props) => {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const tileTheme = useTileTheme();
  const [hoveringViewport, setHoveringViewport] = createSignal(false);
  const [draggingViewport, setDraggingViewport] = createSignal(false);
  // Shared per-device activity window — same signal consumed by the
  // dock-row bucket classifier and the badge gate, so a user who
  // shortens the window in one place shortens it everywhere.
  const isParked = useStaleCheck();

  // ── Bounding box of all tiles ──
  const bounds = createMemo(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of props.tileIds) {
      const l = props.layouts[id];
      if (!l) continue;
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.w);
      maxY = Math.max(maxY, l.y + l.h);
    }
    if (!Number.isFinite(minX))
      return { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 };
    const padMinX = minX - MAP_PAD;
    const padMinY = minY - MAP_PAD;
    const padMaxX = maxX + MAP_PAD;
    const padMaxY = maxY + MAP_PAD;
    return {
      minX: padMinX,
      minY: padMinY,
      maxX: padMaxX,
      maxY: padMaxY,
      w: padMaxX - padMinX,
      h: padMaxY - padMinY,
    };
  });

  // ── Scale factor: fit bounding box into MAP_W × MAP_H ──
  const minimapScale = createMemo(() => {
    const b = bounds();
    return Math.min(MAP_W / b.w, MAP_H / b.h);
  });

  // ── Canvas → minimap coordinate transform ──
  const toMinimap = (cx: number, cy: number, scale: number) => {
    const b = bounds();
    return {
      x: (cx - b.minX) * scale,
      y: (cy - b.minY) * scale,
    };
  };

  // ── Viewport rectangle in minimap space ──
  const viewportRect = createMemo(() => {
    const s = minimapScale();
    const z = viewport.zoom();
    const vs = viewport.viewportSize();
    const vw = vs.width / z;
    const vh = vs.height / z;
    const pos = toMinimap(viewport.panX(), viewport.panY(), s);
    return { x: pos.x, y: pos.y, w: vw * s, h: vh * s };
  });

  // ── Minimap box dimensions — asymmetric by design (see PANEL SEAM): `minW`
  //    is a FLOOR (applied as `min-width`; the box may render wider when the
  //    zoom bar is the wider half), while `h` is the EXACT height (the height
  //    constraint wins the scale, so the box is exactly this tall). `minW` is
  //    NOT the rendered width — don't read it as such. ──
  const mapDims = createMemo(() => {
    const b = bounds();
    const s = minimapScale();
    return { minW: b.w * s, h: b.h * s };
  });

  // ── Viewport rect drag ──
  let abortDrag: AbortController | null = null;
  let abortTileDrag: AbortController | null = null;
  // Suppress map click immediately after a drag ends
  let suppressNextClick = false;
  function handleViewportDrag(e: PointerEvent) {
    abortDrag = startViewportDrag(
      e,
      viewport,
      minimapScale(),
      abortDrag,
      (dragging) => {
        setDraggingViewport(dragging);
        if (!dragging) suppressNextClick = true;
      },
    );
  }

  function handleMapPointerDown(e: PointerEvent) {
    const map = e.currentTarget as HTMLDivElement;
    // rect.left/top = content origin (left-anchored box — see PANEL SEAM below).
    const rect = map.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const view = viewportRect();
    const insideViewport =
      localX >= view.x &&
      localX <= view.x + view.w &&
      localY >= view.y &&
      localY <= view.y + view.h;
    if (!insideViewport) return;
    handleViewportDrag(e);
  }

  function handleMapPointerMove(e: PointerEvent) {
    const map = e.currentTarget as HTMLDivElement;
    // rect.left/top = content origin (left-anchored box — see PANEL SEAM below).
    const rect = map.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const view = viewportRect();
    setHoveringViewport(
      e.target === map &&
        localX >= view.x &&
        localX <= view.x + view.w &&
        localY >= view.y &&
        localY <= view.y + view.h,
    );
  }

  // ── Click on minimap background → pan to that point ──
  function handleMapClick(e: MouseEvent) {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    // PANEL SEAM dead-zone: the map box can render wider than its scaled
    // content (it stretches to the zoom-bar floor — see container comment).
    // That extra right-hand width is inert padding with no represented tile
    // space, so a click there must NOT pan — otherwise localX/minimapScale
    // maps it far past the bounding box's upper X. Tiles map [0, minW] onto
    // the full bounds width, so reject any click past minW. (Height always
    // equals scaled content, so only width grows a dead zone.)
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    if (e.clientX - rect.left > mapDims().minW) return;
    handleMinimapClick(e, viewport, minimapScale(), bounds());
  }

  return (
    <div
      data-testid="canvas-minimap"
      // PANEL SEAM — the map + zoom bar are one pill sharing exactly one width
      // = max(map content, bar content). Enforced by three facts that must
      // change together: (1) this container is absolute/no-width so it
      // shrink-to-fits its widest child and uses `items-stretch` to widen both
      // halves; (2) the map uses `min-width` (not `width`) so it floors at
      // scaled content but stretches wider; (3) the zoom bar declares NO width
      // so its controls set the floor. Change none in isolation — e.g. giving
      // the bar a width, switching to `items-start`, or putting `width` back on
      // the map all silently break the shared-width seam.
      //
      // Also: the box only ever grows RIGHTWARD from `left-4`, which the gesture
      // code depends on (see minimapGestures.ts `getBoundingClientRect` —
      // `rect.left` is the content origin, paired with `toMinimap` mapping
      // minX→0). Centering or right-anchoring the panel breaks BOTH the seam and
      // the click/drag origin.
      class="absolute bottom-4 left-4 z-20 flex flex-col items-stretch gap-px"
    >
      {/* Minimap visualization */}
      <div
        data-testid="minimap-map"
        class="rounded-t-lg bg-surface-2/80 backdrop-blur-sm border border-b-0 border-edge/40 overflow-hidden"
        // `min-width` (not `width`) is fact (2) of the PANEL SEAM — see the
        // container comment above.
        style={{
          "min-width": `${mapDims().minW}px`,
          height: `${mapDims().h}px`,
        }}
        classList={{
          "cursor-default": !hoveringViewport() && !draggingViewport(),
          "cursor-grab": hoveringViewport() && !draggingViewport(),
          "cursor-grabbing": draggingViewport(),
        }}
        onPointerDown={handleMapPointerDown}
        onPointerMove={handleMapPointerMove}
        onPointerLeave={() => setHoveringViewport(false)}
        onClick={handleMapClick}
      >
        {/* Tile rectangles */}
        <For each={props.tileIds}>
          {(id) => {
            const layout = () => props.layouts[id];
            const theme = () => tileTheme(id);
            // Per-tile display info, resolved once and shared by the
            // geometry memo and the badge-state memo. Without this both
            // walked the store's keyed map independently.
            const info = createMemo(() => store.getDisplayInfo(id));
            // Single accessor that yields all the per-tile data the
            // rectangle needs, or null when the tile isn't ready yet
            // (no layout, or metadata still arriving). The `Show` below
            // narrows once instead of forcing a non-null assertion on
            // `getDisplayInfo` per field.
            const tile = createMemo(() => {
              const l = layout();
              const i = info();
              if (!l || !i) return null;
              const s = minimapScale();
              const p = toMinimap(l.x, l.y, s);
              return {
                x: p.x,
                y: p.y,
                w: l.w * s,
                h: l.h * s,
                repoColor: i.repoColor,
              };
            });
            // Reactive accessor: bucket classification (awaiting / working /
            // none) plus user-window staleness. Split from `tile()` so the
            // minute-by-minute staleness tick doesn't invalidate the
            // rectangle geometry — only the badge surface re-runs. Memoized
            // because the JSX reads it 7× per tile per tick.
            const state = createMemo(() => {
              const i = info();
              if (!i) return { bucket: "none" as const, parked: false };
              return {
                bucket: agentBucket(activeArm(i.meta)?.agent),
                parked: isParked(i.meta.lastActivityAt),
              };
            });
            // Hover tooltip — repo · branch[ #suffix] + last-active duration,
            // sourced from the same identity key the workspace switcher uses.
            // Falls back to the bare id when display info hasn't arrived yet
            // (Show guards prevent ever rendering that case, but the accessor
            // stays total).
            const tooltip = () => {
              const i = info();
              return i ? tileTooltip(i, state().parked) : id;
            };
            const handleTileClick = (e: MouseEvent) => {
              // Don't let this also trigger the background pan-to-point.
              e.stopPropagation();
              if (suppressNextClick) {
                suppressNextClick = false;
                return;
              }
              const l = layout();
              if (!l) return;
              props.onSelect(id);
              viewport.centerOnTile(l);
            };
            const handleTilePointerDown = (e: PointerEvent) => {
              e.stopPropagation();
              const drag = props.onStartTileDrag(id);
              if (!drag) return;
              abortTileDrag = startTileDrag(e, minimapScale(), abortTileDrag, {
                onDragStart: () => props.onSelect(id),
                onPreview: drag.preview,
                onCommit: (dx, dy) => {
                  drag.commit(dx, dy);
                  suppressNextClick = true;
                },
              });
            };
            // One morphing element covers both the full rect and the 6 px
            // parked-ghost; CSS interpolates between them so the tile glides
            // when `parked()` flips instead of popping.
            const parked = () => state().parked;
            const isActive = () => tileStore.activeId() === id;
            const hasAgent = () => state().bucket !== "none";
            const badgeVisible = () => hasAgent() && !parked();
            // Parked-bg comes from the `bg-fg-3/40` class (see classList) so a
            // theme or Tailwind-color-space change flows through. Inline bg
            // is for non-parked only — `theme().bg` is a dynamic per-repo
            // color that can't be a static Tailwind token.
            const tileStyle = (t: {
              x: number;
              y: number;
              w: number;
              h: number;
              repoColor: string;
            }): JSX.CSSProperties => {
              if (parked()) {
                return {
                  left: `${t.x + t.w / 2 - GHOST_PX / 2}px`,
                  top: `${t.y + t.h / 2 - GHOST_PX / 2}px`,
                  width: `${GHOST_PX}px`,
                  height: `${GHOST_PX}px`,
                  border: "1px solid transparent",
                };
              }
              return {
                left: `${t.x}px`,
                top: `${t.y}px`,
                width: `${t.w}px`,
                height: `${t.h}px`,
                "background-color": theme().bg,
                border: `1px solid ${t.repoColor}`,
              };
            };
            return (
              <Show when={tile()}>
                {(t) => (
                  <div
                    // Identity stable across the morph; parked-ness queried
                    // via `data-parked`, not by swapping the testid.
                    data-testid="minimap-tile-rect"
                    data-tile-id={id}
                    data-bucket={state().bucket}
                    data-parked={parked() ? "" : undefined}
                    class={`absolute cursor-pointer ${TILE_TRANSITION_PROPS} ${MORPH_TRANSITION} hover:ring-1 hover:ring-accent/40`}
                    classList={{
                      "rounded-full bg-fg-3/40": parked(),
                      "rounded-sm hover:opacity-100": !parked(),
                      "ring-1 ring-accent/60": isActive(),
                      // Active needs solid chrome behind its ring; parked is
                      // already dim from bg-color so don't double-dim. Other
                      // inactive tiles fade to 70 % so the badge + active
                      // tile dominate.
                      "opacity-100": isActive() || parked(),
                      "opacity-70": !isActive() && !parked(),
                    }}
                    style={tileStyle(t())}
                    title={tooltip()}
                    onPointerDown={handleTilePointerDown}
                    onClick={handleTileClick}
                  >
                    {/* Mount-gate stays open while parked so a bucket→none
                        flip mid-park doesn't cut the opacity fade short. */}
                    <Show when={hasAgent() || parked()}>
                      <span
                        data-testid={`minimap-${state().bucket}-dot`}
                        class={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none transition-opacity ${MORPH_TRANSITION}`}
                        classList={{
                          "opacity-0": !badgeVisible(),
                          "opacity-100": badgeVisible(),
                        }}
                        style={{
                          "background-color": bucketDescriptor(state().bucket)
                            .accentVar,
                        }}
                      />
                    </Show>
                  </div>
                )}
              </Show>
            );
          }}
        </For>

        {/* Viewport rectangle */}
        <div
          data-testid="minimap-viewport-rect"
          class="absolute pointer-events-none border-2 border-accent/50 rounded-sm"
          style={{
            left: `${viewportRect().x}px`,
            top: `${viewportRect().y}px`,
            width: `${viewportRect().w}px`,
            height: `${viewportRect().h}px`,
            "background-color":
              "var(--color-accent-alpha, rgba(99, 102, 241, 0.08))",
          }}
        />
      </div>

      {/* Zoom bar — sits flush below the map. NO explicit width is fact (3) of
          the PANEL SEAM: its controls' natural width sets the panel floor. See
          the container comment above. */}
      <div
        data-testid="minimap-zoombar"
        class="flex items-center gap-px bg-surface-2/80 backdrop-blur-sm border border-t-0 border-edge/40 overflow-hidden rounded-b-lg"
      >
        <button
          type="button"
          class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
          title="Zoom out"
          onClick={() => viewport.zoomOut()}
        >
          −
        </button>
        <button
          type="button"
          class="flex items-center justify-center min-w-[3rem] h-8 px-1 text-fg-2 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-xs tabular-nums"
          title="Reset to 100%"
          onClick={() => viewport.resetZoom()}
        >
          {Math.round(viewport.zoom() * 100)}%
        </button>
        <button
          type="button"
          class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
          title="Zoom in"
          onClick={() => viewport.zoomIn()}
        >
          +
        </button>
        <Show when={props.onAutoArrange && props.tileIds.length > 1}>
          <ZoomBarButton
            testId="minimap-arrange"
            title="Arrange canvas by repo"
            icon={<GridIcon class="w-3.5 h-3.5" />}
            onClick={() => props.onAutoArrange?.()}
          />
        </Show>
        <ActivityWindowChip
          anchor="top-end"
          testIdPrefix="minimap-window"
          class="min-w-[2.5rem] h-8 px-1 border-l border-edge/40 text-xs hover:bg-surface-3/60"
        />
      </div>
    </div>
  );
};

export default CanvasMinimap;
