/** Canvas minimap — spatial overview of all tiles + integrated zoom controls. */

import { makePersisted } from "@solid-primitives/storage";
import {
  type Component,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import {
  isMinimapWindow,
  type MinimapWindow,
  WINDOW_VALUES,
  windowOption,
} from "../terminal/activityWindow";
import { useStaleCheckWith } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { GridIcon, MoonIcon } from "../ui/Icons";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import {
  handleMinimapClick,
  startTileDrag,
  startViewportDrag,
} from "./minimapGestures";
import type { TileLayout } from "./TileLayout";
import { useTileTheme } from "./useTileTheme";
import { useCanvasViewport } from "./viewport/useCanvasViewport";
import { agentBucket, bucketDescriptor } from "./workspace-switcher";

/** Minimap target dimensions in pixels. */
const MAP_W = 180;
const MAP_H = 120;
/** Padding around tile bounding box in canvas-space units. */
const MAP_PAD = 100;
/** Diameter (px) of the ghost marker rendered for parked tiles when the
 *  user has hidden them. Big enough to click/drag without being visually
 *  loud. */
const GHOST_PX = 6;

/** Icon button rendered in the right half of the minimap zoom bar — sits
 *  after the zoom controls behind a left divider. The `active` prop lights
 *  the icon in the accent color (used by stateful toggles); plain action
 *  buttons (arrange) leave it `false` and render in the default muted tone.
 *  `ref` lets popover triggers participate in `useAnchoredPopover`; `extra`
 *  carries arbitrary data-attributes a stateful toggle needs (e.g. the
 *  window menu's `data-window`). */
const ZoomBarButton: Component<{
  testId: string;
  title: string;
  icon: JSX.Element;
  onClick: () => void;
  active?: boolean;
  ref?: (el: HTMLButtonElement) => void;
  extra?: Record<string, string>;
}> = (props) => (
  <button
    type="button"
    ref={props.ref}
    data-testid={props.testId}
    data-enabled={props.active ? "" : undefined}
    {...(props.extra ?? {})}
    class="flex items-center justify-center w-7 h-8 hover:bg-surface-3/60 transition-colors cursor-pointer border-l border-edge/40"
    classList={{
      "text-fg-3 hover:text-fg": !props.active,
      "text-accent": props.active,
    }}
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
   *  root deps (`{ store, crud, viewport, isMobile }`) bound once at
   *  App.tsx. The prop carries the bound result; the minimap stays
   *  ignorant of the arrange policy itself. */
  onAutoArrange?: () => void;
}> = (props) => {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const tileTheme = useTileTheme();
  const [hoveringViewport, setHoveringViewport] = createSignal(false);
  const [draggingViewport, setDraggingViewport] = createSignal(false);
  // Per-device viewing preference — stays in localStorage rather than
  // syncing through server preferences.
  const [windowSel, setWindowSel] = makePersisted(
    createSignal<MinimapWindow>("all"),
    {
      name: "kolu-minimap-window",
      serialize: (v) => v,
      deserialize: (raw) => (isMinimapWindow(raw) ? raw : "all"),
    },
  );
  const isParked = useStaleCheckWith(
    () => windowOption(windowSel()).thresholdMs,
  );
  const [menuOpen, setMenuOpen] = createSignal(false);
  const [triggerRef, setTriggerRef] = createSignal<HTMLButtonElement>();
  const { panelRef: menuPanelRef, panelStyle: menuPanelStyle } =
    useAnchoredPopover({
      triggerRef,
      open: menuOpen,
      onDismiss: () => setMenuOpen(false),
      anchor: "top-end",
    });
  const currentWindowLabel = createMemo(() => windowOption(windowSel()).label);

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
            // Reactive accessor: bucket classification (awaiting / working /
            // none) plus user-window staleness. Split from `tile()` so the
            // minute-by-minute staleness tick doesn't invalidate the
            // rectangle geometry — only the badge surface re-runs. Memoized
            // because the JSX reads it 7× per tile per tick.
            const state = createMemo(() => {
              const i = info();
              if (!i) return { bucket: "none" as const, parked: false };
              return {
                bucket: agentBucket(i.meta.agent),
                parked: isParked(i.meta.lastActivityAt),
              };
            });
            // Demoted to a ghost marker whenever the tile falls outside the
            // user's activity window. With `windowSel() === "all"`, threshold
            // is null → `isStale` returns false → nothing is ever ghosted.
            const ghosted = () => state().parked;
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
            return (
              <Show when={tile()}>
                {(t) => (
                  <Show
                    when={!ghosted()}
                    fallback={
                      <div
                        data-testid="minimap-parked-ghost"
                        data-tile-id={id}
                        class="absolute rounded-full bg-fg-3/40 hover:bg-fg-3/80 transition-colors cursor-pointer"
                        classList={{
                          "ring-1 ring-accent/60": store.activeId() === id,
                        }}
                        style={{
                          left: `${t().x + t().w / 2 - GHOST_PX / 2}px`,
                          top: `${t().y + t().h / 2 - GHOST_PX / 2}px`,
                          width: `${GHOST_PX}px`,
                          height: `${GHOST_PX}px`,
                        }}
                        title={`${id} (parked)`}
                        onPointerDown={handleTilePointerDown}
                        onClick={handleTileClick}
                      />
                    }
                  >
                    <div
                      data-testid="minimap-tile-rect"
                      data-tile-id={id}
                      data-bucket={state().bucket}
                      data-parked={state().parked ? "" : undefined}
                      class="absolute rounded-sm transition-opacity cursor-pointer hover:opacity-100 hover:ring-1 hover:ring-accent/40"
                      classList={{
                        "opacity-100 ring-1 ring-accent/60":
                          store.activeId() === id,
                        "opacity-70":
                          store.activeId() !== id && !state().parked,
                        // Parked-but-shown: fades into the background so
                        // non-parked tiles still own the visual weight even
                        // in show-all mode.
                        "opacity-30": store.activeId() !== id && state().parked,
                      }}
                      style={{
                        left: `${t().x}px`,
                        top: `${t().y}px`,
                        width: `${t().w}px`,
                        height: `${t().h}px`,
                        "background-color": theme().bg,
                        border: `1px solid ${t().repoColor}`,
                      }}
                      title={id}
                      onPointerDown={handleTilePointerDown}
                      onClick={handleTileClick}
                    >
                      {/* Bucket badge — color sourced from the bucket
                          descriptor in workspace-switcher/model so adding or
                          recoloring a bucket is a one-file edit. Parked tiles
                          never paint a badge: attention can't outlive the
                          attention it earned. */}
                      <Show when={!state().parked && state().bucket !== "none"}>
                        <span
                          data-testid={`minimap-${state().bucket}-dot`}
                          class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none"
                          style={{
                            "background-color": bucketDescriptor(state().bucket)
                              .accentVar,
                          }}
                        />
                      </Show>
                    </div>
                  </Show>
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
        <ZoomBarButton
          testId="minimap-window-trigger"
          ref={setTriggerRef}
          extra={{ "data-window": windowSel() }}
          title={`Minimap: ${currentWindowLabel()} — click to change`}
          icon={<MoonIcon class="w-3.5 h-3.5" />}
          active={windowSel() !== "all"}
          onClick={() => setMenuOpen((prev) => !prev)}
        />
      </div>
      <Show when={menuOpen()}>
        <Portal>
          <div
            ref={menuPanelRef}
            data-testid="minimap-window-menu"
            class="fixed z-50 flex flex-col bg-surface-1 border border-edge rounded-lg shadow-lg shadow-black/40 p-1 min-w-[160px]"
            style={menuPanelStyle()}
          >
            <For each={WINDOW_VALUES}>
              {(value) => (
                <button
                  type="button"
                  data-testid={`minimap-window-option-${value}`}
                  data-selected={windowSel() === value ? "" : undefined}
                  class="text-left text-xs px-2 py-1.5 rounded-md transition-colors cursor-pointer"
                  classList={{
                    "bg-accent/20 text-accent": windowSel() === value,
                    "text-fg-2 hover:bg-surface-3 hover:text-fg":
                      windowSel() !== value,
                  }}
                  onClick={() => {
                    setWindowSel(value);
                    setMenuOpen(false);
                  }}
                >
                  {windowOption(value).label}
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

export default CanvasMinimap;
