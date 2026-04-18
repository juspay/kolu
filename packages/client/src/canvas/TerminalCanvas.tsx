/** TerminalCanvas — freeform 2D canvas where tiles can be dragged and resized
 *  like desktop windows. Pan via two-finger scroll / trackpad, zoom via
 *  Ctrl+scroll / pinch. Tiles snap to the visual grid on drag end.
 *
 *  The canvas is domain-agnostic — it manages tile positioning, drag, resize,
 *  pan, and zoom. What renders inside each tile (title bar content, body) is
 *  injected via render props by the caller. Positions are read via `getLayout`
 *  and changes are reported via `onLayoutChange` — the caller owns the
 *  source of truth (today: server metadata via subscription).
 *
 *  Drag uses @thisbeyond/solid-dnd (same library as the sidebar) for
 *  gesture handling — decouples sensing from position application.
 *
 *  Pan/zoom viewport logic lives in viewport/ — decomposed by volatility
 *  axis (gestures, transforms, coordinates) per Lowy analysis. */

import {
  type Component,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  type JSX,
} from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import type { TerminalId } from "kolu-common";
import type { TileLayout } from "./TileLayout";
import { useCanvasViewport } from "./viewport/useCanvasViewport";
import { capturePointerGesture } from "./viewport/capturePointerGesture";
import { applyResize, type ResizeDirection } from "./resizeGeometry";
import CanvasTile from "./CanvasTile";
import CanvasMinimap from "./CanvasMinimap";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { useTileTheme } from "./useTileTheme";

const DEFAULT_W = 800;
const DEFAULT_H = 540;
const CASCADE_OFFSET = 30;
const MIN_W = 300;
const MIN_H = 200;

/** Wheel gestures that start inside an xterm tile should scroll the terminal,
 *  not pan the canvas. The viewport's ownership tracker holds this decision
 *  for ~150ms so mid-gesture cursor drift doesn't hand off. */
function isWheelTargetTerminal(e: WheelEvent): boolean {
  return e.target instanceof Element && e.target.closest(".xterm") !== null;
}

function layoutsEqual(a: TileLayout, b: TileLayout): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

const TerminalCanvas: Component<{
  tileIds: TerminalId[];
  /** Optional corner watermark (e.g. `kolu@host`) painted in the
   *  top-left of the canvas. Stays outside the pan/zoom transform so
   *  it reads as a fixed identity mark on the surface, not a tile. */
  watermark?: string;
  /** Saved layout for a tile, or undefined if none exists yet. */
  getLayout: (id: TerminalId) => TileLayout | undefined;
  /** Report a layout change (drag commit, resize commit, default assignment). */
  onLayoutChange: (id: TerminalId, layout: TileLayout) => void;
  onSelect: (id: TerminalId) => void;
  onClose: (id: TerminalId) => void;
  renderTileTitle: (id: TerminalId) => JSX.Element;
  /** Optional title-bar actions injected between the title and the close
   *  button — e.g. the screenshot button, theme pill, agent indicator. */
  renderTileTitleActions?: (id: TerminalId) => JSX.Element;
  /** `active` is passed as an accessor so the subtree doesn't remount on
   *  every focus change — reads happen inside the returned JSX's props
   *  (fine-grained reactivity), not around the render-prop effect. */
  renderTileBody: (id: TerminalId, active: () => boolean) => JSX.Element;
}> = (props) => {
  const viewport = useCanvasViewport();
  const store = useTerminalStore();
  const tileTheme = useTileTheme();

  /** Pending per-tile layout overrides — used for three cases, all bridging
   *  a gap until the server's metadata echo arrives:
   *    1. Default-position seed: a new tile's cascade layout, so the first
   *       paint isn't at (0,0) before the echo.
   *    2. Drag commit: hold the drop position until getLayout catches up —
   *       solid-dnd has already reset its transform to 0 by then.
   *    3. Resize preview: live width/height during pointer-move; snapped
   *       value on pointer-up until the server echoes the committed size.
   *  Entries auto-clear when the echoed layout matches (effect below). */
  const [pending, setPending] = createSignal<Record<string, TileLayout>>({});

  function setPendingLayout(id: string, layout: TileLayout) {
    setPending((prev) => ({ ...prev, [id]: layout }));
  }

  createEffect(() => {
    const p = pending();
    const alive = new Set(props.tileIds);
    let changed = false;
    const next: Record<string, TileLayout> = {};
    for (const [id, layout] of Object.entries(p)) {
      // Drop entries for removed tiles — metadata never arrives for them.
      if (!alive.has(id)) {
        changed = true;
        continue;
      }
      const current = props.getLayout(id);
      if (current && layoutsEqual(current, layout)) {
        changed = true;
      } else {
        next[id] = layout;
      }
    }
    if (changed) setPending(next);
  });

  /** Effective layout for a tile (pending override wins over saved). */
  function layoutOf(id: string): TileLayout | undefined {
    return pending()[id] ?? props.getLayout(id);
  }

  /** Merged layouts keyed by tile ID — consumed by CanvasTile and CanvasMinimap. */
  const layouts = createMemo<Record<string, TileLayout>>(() => {
    const result: Record<string, TileLayout> = {};
    for (const id of props.tileIds) {
      const l = layoutOf(id);
      if (l) result[id] = l;
    }
    return result;
  });

  // Auto-assign a default layout for tiles with no saved position.
  // The pending seed makes the tile paint at the cascade position on its
  // first render — without it, there would be a (0,0) frame while waiting
  // for the server's metadata echo.
  createEffect(
    on(
      () => props.tileIds,
      (ids) => {
        // Viewport center in canvas-space — stable within this batch
        const cx =
          viewport.panX() + containerRef.clientWidth / (2 * viewport.zoom());
        const cy =
          viewport.panY() + containerRef.clientHeight / (2 * viewport.zoom());
        let newIndex = 0;
        for (const id of ids) {
          if (layoutOf(id)) continue;
          const offset = newIndex * CASCADE_OFFSET;
          const defaultLayout: TileLayout = {
            x: viewport.snapToGrid(cx - DEFAULT_W / 2 + offset),
            y: viewport.snapToGrid(cy - DEFAULT_H / 2 + offset),
            w: DEFAULT_W,
            h: DEFAULT_H,
          };
          setPendingLayout(id, defaultLayout);
          props.onLayoutChange(id, defaultLayout);
          newIndex++;
        }
      },
    ),
  );

  // solid-dnd resets the draggable transform before onDragEnd fires,
  // so we capture the last known delta during onDragMove.
  const [dragDelta, setDragDelta] = createSignal({ x: 0, y: 0 });

  function handleDragMove({ draggable }: DragEvent) {
    if (draggable)
      setDragDelta({ x: draggable.transform.x, y: draggable.transform.y });
  }

  /** Apply captured drag delta to the tile's persisted position.
   *  Delta is in screen-space — normalize by zoom for canvas-space. */
  function handleDragEnd({ draggable }: DragEvent) {
    if (!draggable) return;
    const id = draggable.id as string;
    const l = layoutOf(id);
    if (!l) return;
    const { x: sdx, y: sdy } = dragDelta();
    if (sdx !== 0 || sdy !== 0) {
      const { dx, dy } = viewport.normalizeDelta(sdx, sdy);
      const next: TileLayout = {
        ...l,
        x: viewport.snapToGrid(l.x + dx),
        y: viewport.snapToGrid(l.y + dy),
      };
      // Hold pending until metadata echo arrives — avoids a frame where
      // solid-dnd's transform has reset to 0 but getLayout still returns
      // the pre-drag position.
      setPendingLayout(id, next);
      props.onLayoutChange(id, next);
    }
    setDragDelta({ x: 0, y: 0 });
  }

  /** Start resizing a tile from the given edge or corner.
   *  Pointer deltas are in screen-space — normalize by zoom. */
  let abortResize: AbortController | null = null;
  function startResize(
    id: string,
    direction: ResizeDirection,
    e: PointerEvent,
  ) {
    e.preventDefault();
    e.stopPropagation();
    const origin = layoutOf(id);
    if (!origin) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const limits = { minW: MIN_W, minH: MIN_H };

    abortResize?.abort();
    abortResize = new AbortController();
    capturePointerGesture(
      {
        onMove: (ev) => {
          const { dx, dy } = viewport.normalizeDelta(
            ev.clientX - startX,
            ev.clientY - startY,
          );
          setPendingLayout(id, applyResize(origin, direction, dx, dy, limits));
        },
        onEnd: (ev) => {
          abortResize = null;
          // No motion — skip commit so a bare click doesn't round-trip the server.
          if (!pending()[id]) return;
          const { dx, dy } = viewport.normalizeDelta(
            ev.clientX - startX,
            ev.clientY - startY,
          );
          const snapped = applyResize(
            origin,
            direction,
            dx,
            dy,
            limits,
            viewport.snapToGrid,
          );
          setPendingLayout(id, snapped);
          props.onLayoutChange(id, snapped);
        },
      },
      abortResize,
    );
  }

  // On first mount at the default origin, pan so the persisted active tile
  // is centered (matches what a pill-tree click does). If there's no
  // active tile, fall back to centering the bounding box of all tiles so
  // restored sessions whose tiles live far from (0,0) don't open empty.
  let containerRef!: HTMLDivElement;
  const isDefaultViewport = () =>
    viewport.panX() === 0 && viewport.panY() === 0 && viewport.zoom() === 1;

  createEffect(() => {
    const ids = props.tileIds;
    if (ids.length === 0 || !isDefaultViewport()) return;
    const active = store.activeId();
    const activeLayout = active ? layoutOf(active) : undefined;
    if (activeLayout) {
      requestAnimationFrame(() => viewport.centerOnTile(activeLayout));
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const id of ids) {
      const l = layoutOf(id);
      if (!l) continue;
      minX = Math.min(minX, l.x);
      minY = Math.min(minY, l.y);
      maxX = Math.max(maxX, l.x + l.w);
      maxY = Math.max(maxY, l.y + l.h);
    }
    if (!isFinite(minX)) return;
    requestAnimationFrame(() => {
      viewport.panTo((minX + maxX) / 2, (minY + maxY) / 2);
    });
  });

  return (
    <DragDropProvider onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <DragDropSensors />
      <div
        ref={(el) => {
          containerRef = el;
          viewport.setContainerRef(el, isWheelTargetTerminal);
        }}
        data-testid="canvas-container"
        data-zoom={viewport.zoom()}
        class="flex-1 min-h-0 overflow-hidden relative canvas-grid-bg"
        style={{
          "background-position": viewport.gridBgPosition(),
          "background-size": viewport.gridBgSize(),
        }}
      >
        {/* Identity watermark — top-left, just below the chrome bar so
         *  it doesn't collide with the logo. The chrome bar is ~44px tall
         *  in overlay mode; `top-12` (48px) clears it with a hairline of
         *  breathing room. Low opacity, mono; pointer-events-none so
         *  drags/clicks pass through to the canvas. */}
        <Show when={props.watermark}>
          {(text) => (
            <div
              data-testid="canvas-watermark"
              aria-hidden="true"
              class="absolute top-12 left-3 z-0 font-mono text-[0.7rem] tracking-wide text-fg-3/40 pointer-events-none select-none"
            >
              {text()}
            </div>
          )}
        </Show>
        {/* renderTile: one definition shared by tiled and maximized
         *  branches — the only difference is the `maximized` boolean
         *  and (for tiled) the active-state read derived from store. */}
        {(() => {
          const renderTile = (id: TerminalId, maximized: boolean) => (
            <CanvasTile
              id={id}
              active={maximized || store.activeId() === id}
              maximized={maximized}
              activity={
                store.getDisplayInfo(id)?.activityHistory.at(-1)?.[1]
                  ? "active"
                  : "sleeping"
              }
              theme={tileTheme(id)}
              onSelect={() => props.onSelect(id)}
              onClose={() => props.onClose(id)}
              onToggleMaximize={store.toggleCanvasMaximized}
              renderTitle={() => props.renderTileTitle(id)}
              renderTitleActions={
                props.renderTileTitleActions
                  ? () => props.renderTileTitleActions!(id)
                  : undefined
              }
              renderBody={() =>
                props.renderTileBody(id, () => store.activeId() === id)
              }
              layouts={layouts()}
              startResize={startResize}
              zoom={viewport.zoom}
            />
          );
          return (
            <>
              {/* Tiled canvas — tiles live inside the pan/zoom transform.
               *  Hidden entirely when maximized; no reason to paint
               *  tiles the user can't see. */}
              <Show when={!store.canvasMaximized()}>
                <div
                  style={{
                    "transform-origin": "0 0",
                    transform: viewport.canvasTransform(),
                  }}
                >
                  <For each={props.tileIds}>
                    {(id) => renderTile(id, false)}
                  </For>
                </div>
              </Show>

              {/* Maximized view — only the active tile, outside any
               *  transform, covering the canvas via `absolute inset-0`. */}
              <Show when={store.canvasMaximized() && store.activeId()} keyed>
                {(id) => renderTile(id, true)}
              </Show>
            </>
          );
        })()}

        {/* Minimap: spatial dashboard; hides in fullscreen-single-tile mode
         *  since there's nothing spatial to summarize. */}
        <Show when={!store.canvasMaximized()}>
          <CanvasMinimap
            tileIds={props.tileIds}
            layouts={layouts()}
            onSelect={props.onSelect}
          />
        </Show>
      </div>
    </DragDropProvider>
  );
};

export default TerminalCanvas;
