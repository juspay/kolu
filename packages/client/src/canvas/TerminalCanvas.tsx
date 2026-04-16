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
import type { TileLayout } from "./TileLayout";
import { useCanvasViewport } from "./viewport/useCanvasViewport";
import { capturePointerGesture } from "./viewport/capturePointerGesture";
import { applyResize, type ResizeDirection } from "./resizeGeometry";
import CanvasTile, { type TileTheme } from "./CanvasTile";
import CanvasMinimap from "./CanvasMinimap";

const DEFAULT_W = 700;
const DEFAULT_H = 500;
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
  tileIds: string[];
  activeId: string | null;
  getTileTheme: (id: string) => TileTheme;
  /** Saved layout for a tile, or undefined if none exists yet. */
  getLayout: (id: string) => TileLayout | undefined;
  /** Report a layout change (drag commit, resize commit, default assignment). */
  onLayoutChange: (id: string, layout: TileLayout) => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  renderTileTitle: (id: string) => JSX.Element;
  /** `active` is passed as an accessor so the subtree doesn't remount on
   *  every focus change — reads happen inside the returned JSX's props
   *  (fine-grained reactivity), not around the render-prop effect. */
  renderTileBody: (id: string, active: () => boolean) => JSX.Element;
}> = (props) => {
  const viewport = useCanvasViewport();

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

  // On first mount at the default origin, pan so the tile bounding box is
  // centered — prevents restored sessions (whose tiles may live far from
  // (0,0)) from opening with the viewport empty.
  let containerRef!: HTMLDivElement;
  const isDefaultViewport = () =>
    viewport.panX() === 0 && viewport.panY() === 0 && viewport.zoom() === 1;

  createEffect(() => {
    const ids = props.tileIds;
    if (ids.length === 0 || !isDefaultViewport()) return;
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
        <div
          style={{
            "transform-origin": "0 0",
            transform: viewport.canvasTransform(),
          }}
        >
          <For each={props.tileIds}>
            {(id) => (
              <CanvasTile
                id={id}
                active={props.activeId === id}
                theme={props.getTileTheme(id)}
                onSelect={() => props.onSelect(id)}
                onClose={() => props.onClose(id)}
                renderTitle={() => props.renderTileTitle(id)}
                renderBody={() =>
                  props.renderTileBody(id, () => props.activeId === id)
                }
                layouts={layouts()}
                startResize={startResize}
                zoom={viewport.zoom}
              />
            )}
          </For>
        </div>

        <CanvasMinimap
          tileIds={props.tileIds}
          activeId={props.activeId}
          layouts={layouts()}
          getTileTheme={props.getTileTheme}
        />
      </div>
    </DragDropProvider>
  );
};

export default TerminalCanvas;
