/** Canvas minimap — spatial overview of all tiles + integrated zoom controls.
 *  Two states: expanded (minimap visualization + zoom bar) and minimized
 *  (zoom bar only). Auto-hides the map when ≤2 tiles. */

import { type Component, For, Show, createMemo, createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { MinimapIcon, ZoomToFitIcon } from "../ui/Icons";
import { SHORTCUTS, formatKeybind } from "../input/keyboard";
import { useCanvasViewport } from "./viewport/useCanvasViewport";
import { startViewportDrag, handleMinimapClick } from "./minimapGestures";
import type { TileLayout } from "./useCanvasLayouts";
import type { TileTheme } from "./CanvasTile";

/** Minimap target dimensions in pixels. */
const MAP_W = 180;
const MAP_H = 120;
/** Padding around tile bounding box in canvas-space units. */
const MAP_PAD = 100;
/** Show full minimap only when tile count exceeds this. */
const AUTO_SHOW_THRESHOLD = 2;

/** Singleton expanded state — persisted across reloads. */
const [expanded, setExpanded] = makePersisted(createSignal(true), {
  name: "kolu-minimap-expanded",
});

export function toggleMinimap() {
  setExpanded((v) => !v);
}

const CanvasMinimap: Component<{
  tileIds: string[];
  activeId: string | null;
  layouts: Record<string, TileLayout>;
  getTileTheme: (id: string) => TileTheme;
  onFitAll: () => void;
}> = (props) => {
  const viewport = useCanvasViewport();

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
    if (!isFinite(minX))
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

  // ── Whether to show the full minimap or just the zoom bar ──
  const shouldShowMap = createMemo(
    () => expanded() && props.tileIds.length > AUTO_SHOW_THRESHOLD,
  );

  // ── Viewport rect drag ──
  let abortDrag: (() => void) | null = null;
  function handleViewportDrag(e: PointerEvent) {
    abortDrag = startViewportDrag(e, viewport, minimapScale(), abortDrag);
  }

  // ── Click on minimap background → pan to that point ──
  function handleMapClick(e: MouseEvent) {
    handleMinimapClick(e, viewport, minimapScale(), bounds());
  }

  return (
    <div class="absolute bottom-4 left-4 z-20 flex flex-col items-start gap-px">
      {/* Minimap visualization */}
      <Show when={shouldShowMap()}>
        <div
          class="rounded-t-lg bg-surface-2/80 backdrop-blur-sm border border-b-0 border-edge/40 overflow-hidden cursor-default"
          style={{ width: `${mapDims().w}px`, height: `${mapDims().h}px` }}
          onClick={handleMapClick}
        >
          {/* Tile rectangles */}
          <For each={props.tileIds}>
            {(id) => {
              const layout = () => props.layouts[id];
              const theme = () => props.getTileTheme(id);
              const pos = () => {
                const l = layout();
                if (!l) return null;
                const s = minimapScale();
                const p = toMinimap(l.x, l.y, s);
                return { x: p.x, y: p.y, w: l.w * s, h: l.h * s };
              };
              return (
                <Show when={pos()}>
                  {(p) => (
                    <div
                      class="absolute rounded-sm transition-opacity pointer-events-none"
                      classList={{
                        "opacity-100 ring-1 ring-accent/60":
                          props.activeId === id,
                        "opacity-70": props.activeId !== id,
                      }}
                      style={{
                        left: `${p().x}px`,
                        top: `${p().y}px`,
                        width: `${p().w}px`,
                        height: `${p().h}px`,
                        "background-color": theme().bg,
                        border: `1px solid color-mix(in oklch, ${theme().fg} 25%, ${theme().bg})`,
                      }}
                      title={id}
                    />
                  )}
                </Show>
              );
            }}
          </For>

          {/* Viewport rectangle */}
          <div
            class="absolute border-2 border-accent/50 rounded-sm cursor-grab active:cursor-grabbing"
            style={{
              left: `${viewportRect().x}px`,
              top: `${viewportRect().y}px`,
              width: `${viewportRect().w}px`,
              height: `${viewportRect().h}px`,
              "background-color":
                "var(--color-accent-alpha, rgba(99, 102, 241, 0.08))",
            }}
            onPointerDown={handleViewportDrag}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </Show>

      {/* Zoom bar — always visible */}
      <div
        class="flex items-center gap-px bg-surface-2/80 backdrop-blur-sm border border-edge/40 overflow-hidden"
        classList={{
          "rounded-lg": !shouldShowMap(),
          "rounded-b-lg border-t-0": shouldShowMap(),
        }}
        style={shouldShowMap() ? { width: `${mapDims().w}px` } : undefined}
      >
        {/* Minimap toggle */}
        <button
          class="flex items-center justify-center w-8 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer"
          classList={{ "text-accent": expanded() }}
          title="Toggle minimap"
          onClick={() => toggleMinimap()}
        >
          <MinimapIcon class="w-3.5 h-3.5" />
        </button>
        <div class="w-px h-5 bg-edge/30" />
        <button
          class="flex items-center justify-center w-8 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer"
          title={`Zoom to fit (${formatKeybind(SHORTCUTS.canvasFitAll.keybind)})`}
          onClick={() => props.onFitAll()}
        >
          <ZoomToFitIcon class="w-3.5 h-3.5" />
        </button>
        <div class="w-px h-5 bg-edge/30" />
        <button
          class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
          title="Zoom out"
          onClick={() => viewport.zoomOut()}
        >
          −
        </button>
        <button
          class="flex items-center justify-center min-w-[3rem] h-8 px-1 text-fg-2 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-xs tabular-nums"
          title="Reset to 100%"
          onClick={() => viewport.resetZoom()}
        >
          {Math.round(viewport.zoom() * 100)}%
        </button>
        <button
          class="flex items-center justify-center w-7 h-8 text-fg-3 hover:text-fg hover:bg-surface-3/60 transition-colors cursor-pointer text-sm font-medium"
          title="Zoom in"
          onClick={() => viewport.zoomIn()}
        >
          +
        </button>
      </div>
    </div>
  );
};

export default CanvasMinimap;
