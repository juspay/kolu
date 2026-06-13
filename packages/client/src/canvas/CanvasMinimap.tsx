/** Canvas minimap — spatial overview of all tiles + integrated zoom controls. */

import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";
import { formatTimeAgo } from "../terminal/staleness";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { ActivityWindowChip } from "../ui/ActivityWindowChip";
import { GridIcon } from "../ui/Icons";
import {
  handleMinimapClick,
  startTileDrag,
  startViewportDrag,
} from "./minimapGestures";
import type { TileLayout } from "./TileLayout";
import type { TileAura } from "./tileAura";
import { useTileAura } from "./useTileAura";
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
   *  Why a prop and not `useCanvasArrange()` directly: this minimap
   *  consumes `useCanvasViewport()` and `useTerminalStore()` as
   *  zero-arg singletons, but `useCanvasArrange` takes composition-
   *  root deps (`{ store, crud }`) bound once at
   *  App.tsx. The prop carries the bound result; the minimap stays
   *  ignorant of the arrange policy itself. */
  onAutoArrange?: () => void;
}> = (props) => {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const [hoveringViewport, setHoveringViewport] = createSignal(false);
  const [draggingViewport, setDraggingViewport] = createSignal(false);
  // Per-tile classification via the shared `useTileAura()` socket — one gather
  // (agentBucket + unread + staleness) the full canvas tile uses too. The
  // minimap projects every bit it needs off this one read: the aura tier, the
  // `data-bucket` attribute, and the `parked` (stale) ghost gate — so neither
  // `agentBucket` nor `useStaleCheck` runs a second time per tile on this
  // surface. Staleness uses the same per-device activity window everywhere, so
  // shortening the window in one place shortens it for the parked gate too.
  const auraFor = useTileAura();

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

  // ── Minimap rendered dimensions (shrink-to-fit) ──
  const mapDims = createMemo(() => {
    const b = bounds();
    const s = minimapScale();
    return { w: b.w * s, h: b.h * s };
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
    handleMinimapClick(e, viewport, minimapScale(), bounds());
  }

  return (
    <div
      data-testid="canvas-minimap"
      class="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-px"
    >
      {/* Minimap visualization */}
      <div
        data-testid="minimap-map"
        class="rounded-t-lg bg-surface-2/80 backdrop-blur-sm border border-b-0 border-edge/40 overflow-hidden"
        style={{ width: `${mapDims().w}px`, height: `${mapDims().h}px` }}
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
            // One read of the shared aura socket per tile — bucket, staleness,
            // and the folded aura tier all come from this single gather so the
            // classifiers don't run twice on the minimap. Split from `tile()`
            // so the minute-by-minute staleness tick doesn't invalidate the
            // rectangle geometry — only the badge surface re-runs. Memoized
            // because the JSX projects it (bucket, parked, aura) many times per
            // tile per tick.
            const socket = createMemo(() => auraFor(id));
            // Reactive accessor: bucket classification (awaiting / working /
            // none) plus user-window staleness, both projected from the socket.
            const state = createMemo(() => ({
              bucket: socket().bucket,
              parked: socket().stale,
            }));
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
            const isActive = () => store.activeId() === id;
            // Same aura tier the full canvas tile paints — one mapper, two
            // scales. Parked tiles render as ghosts (no bar), so the stale
            // ember tier never surfaces here; a fresh awaiter pulses, a worker
            // hums, an unread alert blinks. Projected from the same socket read
            // as `state()` above, so the bar renders only working/waiting/alert.
            const auraTier = (): TileAura => socket().aura;
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
                    data-aura={auraTier()}
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
                    {/* State aura — the same top-edge bar the full canvas tile
                        paints (index.css `.aura-bar`, coloured via the rect's
                        `data-aura`), at minimap scale. Only for live, non-parked
                        tiles; parked tiles are already the recessive ghost. */}
                    <Show when={!parked() && auraTier() !== "none"}>
                      <div
                        data-testid="minimap-tile-aura"
                        class="aura-bar aura-bar--mini"
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

      {/* Zoom bar — sits flush below the map */}
      <div
        class="flex items-center gap-px bg-surface-2/80 backdrop-blur-sm border border-t-0 border-edge/40 overflow-hidden rounded-b-lg"
        style={{ width: `${mapDims().w}px` }}
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
