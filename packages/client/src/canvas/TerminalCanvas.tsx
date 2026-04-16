/** TerminalCanvas — freeform 2D canvas where tiles can be dragged and resized
 *  like desktop windows. Pan via two-finger scroll / trackpad, zoom via
 *  Ctrl+scroll / pinch. Tiles snap to the visual grid on drag end.
 *
 *  The canvas is domain-agnostic — it manages tile positioning, drag, resize,
 *  pan, and zoom. What renders inside each tile (title bar content, body) is
 *  injected via render props by the caller.
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
  createSignal,
  on,
  batch,
  type JSX,
} from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import { useCanvasLayouts, type TileLayout } from "./useCanvasLayouts";
import { useCanvasViewport } from "./viewport/useCanvasViewport";
import { capturePointerGesture } from "./viewport/capturePointerGesture";
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

const TerminalCanvas: Component<{
  tileIds: string[];
  activeId: string | null;
  getTileTheme: (id: string) => TileTheme;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  renderTileTitle: (id: string) => JSX.Element;
  /** Optional per-tile chrome actions (screenshot, future: pin, duplicate…).
   *  Rendered in the title bar between title and close button. */
  renderTileActions?: (id: string) => JSX.Element;
  renderTileBody: (id: string, active: boolean) => JSX.Element;
}> = (props) => {
  const { layouts, setLayouts, reportLayout } = useCanvasLayouts();
  const viewport = useCanvasViewport();

  // Auto-assign layout for new tiles and clean up removed ones
  createEffect(
    on(
      () => props.tileIds,
      (ids) => {
        const idSet = new Set(ids);
        batch(() => {
          for (const key of Object.keys(layouts)) {
            if (!idSet.has(key)) setLayouts(key, undefined!);
          }
          // Viewport center in canvas-space — stable within this batch
          const cx =
            viewport.panX() + containerRef.clientWidth / (2 * viewport.zoom());
          const cy =
            viewport.panY() + containerRef.clientHeight / (2 * viewport.zoom());
          let newIndex = 0;
          for (const id of ids) {
            if (!layouts[id]) {
              const offset = newIndex * CASCADE_OFFSET;
              setLayouts(id, {
                x: viewport.snapToGrid(cx - DEFAULT_W / 2 + offset),
                y: viewport.snapToGrid(cy - DEFAULT_H / 2 + offset),
                w: DEFAULT_W,
                h: DEFAULT_H,
              });
              newIndex++;
            }
          }
        });
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
    const l = layouts[id];
    if (!l) return;
    const { x: sdx, y: sdy } = dragDelta();
    if (sdx !== 0 || sdy !== 0) {
      const { dx, dy } = viewport.normalizeDelta(sdx, sdy);
      setLayouts(id, {
        ...l,
        x: viewport.snapToGrid(l.x + dx),
        y: viewport.snapToGrid(l.y + dy),
      });
      reportLayout(id);
    }
    setDragDelta({ x: 0, y: 0 });
  }

  /** Snap size to grid and report to server. Separated from the pointerup
   *  listener so state application isn't tangled with event cleanup. */
  function commitResize(id: string) {
    const cur = layouts[id];
    if (cur) {
      setLayouts(id, {
        ...cur,
        w: viewport.snapToGrid(cur.w),
        h: viewport.snapToGrid(cur.h),
      });
    }
    reportLayout(id);
  }

  /** Start resizing a tile from the bottom-right corner.
   *  Pointer deltas are in screen-space — normalize by zoom. */
  let abortResize: (() => void) | null = null;
  function startResize(id: string, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const l = layouts[id];
    if (!l) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = l.w;
    const origH = l.h;
    const origX = l.x;
    const origY = l.y;

    abortResize?.();
    abortResize = capturePointerGesture({
      onMove: (ev) => {
        const { dx, dy } = viewport.normalizeDelta(
          ev.clientX - startX,
          ev.clientY - startY,
        );
        setLayouts(id, {
          x: origX,
          y: origY,
          w: Math.max(MIN_W, origW + dx),
          h: Math.max(MIN_H, origH + dy),
        });
      },
      onEnd: () => {
        abortResize = null;
        commitResize(id);
      },
    });
  }

  // Auto-center when viewport is at the default origin (pan=0, zoom=1)
  // and tiles exist. Derived from actual state, so it survives remounts
  // and re-centers if the user resets zoom via the toolbar.
  let containerRef!: HTMLDivElement;
  const isDefaultViewport = () =>
    viewport.panX() === 0 && viewport.panY() === 0 && viewport.zoom() === 1;

  createEffect(() => {
    const ids = props.tileIds;
    if (ids.length === 0 || !isDefaultViewport()) return;
    const allLayouts: TileLayout[] = [];
    for (const id of ids) {
      const l = layouts[id];
      if (l) allLayouts.push(l);
    }
    if (allLayouts.length === 0) return;
    requestAnimationFrame(() => {
      viewport.fitAll(allLayouts);
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
                renderTitleActions={
                  props.renderTileActions
                    ? () => props.renderTileActions!(id)
                    : undefined
                }
                renderBody={() =>
                  props.renderTileBody(id, props.activeId === id)
                }
                layouts={layouts}
                startResize={startResize}
                zoom={viewport.zoom}
              />
            )}
          </For>
        </div>

        <CanvasMinimap
          tileIds={props.tileIds}
          activeId={props.activeId}
          layouts={layouts}
          getTileTheme={props.getTileTheme}
          onFitAll={() => {
            const allLayouts: TileLayout[] = [];
            for (const id of props.tileIds) {
              const l = layouts[id];
              if (l) allLayouts.push(l);
            }
            viewport.fitAll(allLayouts);
          }}
        />
      </div>
    </DragDropProvider>
  );
};

export default TerminalCanvas;
