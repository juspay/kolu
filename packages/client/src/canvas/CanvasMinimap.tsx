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
import { formatTimeAgo, useStaleCheckWith } from "../terminal/staleness";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { GridIcon } from "../ui/Icons";
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
/** Duration + easing for the morph between full rect and ghost. Shared by
 *  the tile (transition-all) and the bucket badge (transition-opacity) so
 *  the geometry change and the badge fade always run on the same clock. */
const MORPH_TRANSITION = "duration-300 ease-out";

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
            // A single morphing element handles both the full rect and the
            // 6 px parked-ghost. The CSS `transition-all` then animates the
            // geometry, color, and border-radius between the two states so a
            // tile glides into / out of its ghost form (300 ms) instead of
            // popping when `state().parked` flips — either because the user
            // picked a stricter activity window or because a tile crossed
            // the staleness threshold over time.
            const parked = () => state().parked;
            const isActive = () => store.activeId() === id;
            // Tile opacity is governed by two independent reasons:
            //   - Active → 100 %: the focused tile must read as the focused
            //     tile (its ring needs solid chrome behind it).
            //   - Parked → 100 %: the dim color already conveys low
            //     attention, so dropping opacity on top would double-dim.
            // Anything else (inactive, non-parked) fades to 70 % so the
            // bucket badge and the active tile pop visually.
            const tileOpacity = () =>
              isActive() || parked() ? "opacity-100" : "opacity-70";
            // Geometry + repo-color border for the morphing tile. Parked tiles
            // get their dim background from the `bg-fg-3/40` Tailwind class
            // (see classList below) — keeping the design-system token as the
            // single source of truth for parked color so a theme change or a
            // Tailwind colour-space upgrade flows through automatically. The
            // inline `theme().bg` is for the non-parked branch only, where
            // the bg is a dynamic per-repo color that can't be a Tailwind
            // token.
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
                    // Stable across the parking morph — the element's identity
                    // doesn't change just because its size and color do.
                    // Consumers (e2e selectors, dev-tools inspection) that
                    // care about parked-ness read `data-parked`.
                    data-testid="minimap-tile-rect"
                    data-tile-id={id}
                    data-bucket={state().bucket}
                    data-parked={parked() ? "" : undefined}
                    class={`absolute cursor-pointer transition-all ${MORPH_TRANSITION} hover:ring-1 hover:ring-accent/40`}
                    classList={{
                      "rounded-full bg-fg-3/40": parked(),
                      "rounded-sm hover:opacity-100": !parked(),
                      "ring-1 ring-accent/60": isActive(),
                      [tileOpacity()]: true,
                    }}
                    style={tileStyle(t())}
                    title={tooltip()}
                    onPointerDown={handleTilePointerDown}
                    onClick={handleTileClick}
                  >
                    {/* Bucket badge — color sourced from the bucket descriptor
                        in workspace-switcher/model so adding or recoloring a
                        bucket is a one-file edit. Parked tiles never paint a
                        badge at steady state (attention can't outlive the
                        attention it earned). The mount gate keeps the badge
                        alive whenever it has something to show OR is fading
                        out during a parking transition — without this, a
                        bucket→none flip mid-park would unmount instantly and
                        cut the opacity fade short. */}
                    <Show when={state().bucket !== "none" || parked()}>
                      <span
                        data-testid={`minimap-${state().bucket}-dot`}
                        class={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full pointer-events-none transition-opacity ${MORPH_TRANSITION}`}
                        classList={{
                          "opacity-0": parked() || state().bucket === "none",
                          "opacity-100": !parked() && state().bucket !== "none",
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
        <button
          type="button"
          ref={setTriggerRef}
          data-testid="minimap-window-trigger"
          data-enabled={windowSel() !== "all" ? "" : undefined}
          data-window={windowSel()}
          class="flex items-center justify-center min-w-[2.5rem] h-8 px-1 hover:bg-surface-3/60 transition-colors cursor-pointer border-l border-edge/40 text-xs tabular-nums"
          classList={{
            "text-fg-2 hover:text-fg": windowSel() === "all",
            "text-accent": windowSel() !== "all",
          }}
          title={`Minimap: ${currentWindowLabel()} — click to change`}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          {windowOption(windowSel()).short}
        </button>
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
