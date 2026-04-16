/** TerminalCanvas — freeform 2D canvas where terminals can be dragged
 *  and resized like desktop windows. Pan via two-finger scroll / trackpad,
 *  zoom via Ctrl+scroll / pinch. Tiles snap to the visual grid on drag end.
 *
 *  Drag uses @thisbeyond/solid-dnd (same library as the sidebar) for
 *  gesture handling — decouples sensing from position application.
 *  Resize uses raw pointer events with AbortController for cleanup
 *  (resize is not a drag-to-position gesture, so solid-dnd doesn't fit).
 *
 *  Pan/zoom viewport logic lives in useCanvasViewport — extracted so the
 *  navigation mechanism (CSS transforms) can evolve independently of tile
 *  layout state (useCanvasLayouts). */

import {
  type Component,
  For,
  createEffect,
  createSignal,
  on,
  batch,
} from "solid-js";
import {
  DragDropProvider,
  DragDropSensors,
  createDraggable,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import type { ITheme } from "@xterm/xterm";
import TerminalContent from "./TerminalContent";
import TerminalMeta from "./TerminalMeta";
import { ResizeGripIcon } from "../ui/Icons";
import { useCanvasLayouts, type TileLayout } from "./useCanvasLayouts";
import { useCanvasViewport } from "./useCanvasViewport";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const DEFAULT_W = 700;
const DEFAULT_H = 500;
const CASCADE_OFFSET = 30;
const MIN_W = 300;
const MIN_H = 200;

const TerminalCanvas: Component<{
  terminalIds: TerminalId[];
  activeId: TerminalId | null;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
  getTerminalTheme: (id: TerminalId) => ITheme;
  onSelect: (id: TerminalId) => void;
  onCloseTerminal: (id: TerminalId) => void;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  activeMeta: TerminalMetadata | null;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  subTerminalIds: (id: TerminalId) => TerminalId[];
}> = (props) => {
  const { layouts, setLayouts, reportLayout } = useCanvasLayouts();
  const viewport = useCanvasViewport();

  // Auto-assign layout for new terminals and clean up removed ones
  createEffect(
    on(
      () => props.terminalIds,
      (ids) => {
        const idSet = new Set(ids as string[]);
        batch(() => {
          for (const key of Object.keys(layouts)) {
            if (!idSet.has(key)) setLayouts(key, undefined!);
          }
          let nextIndex = 0;
          for (const id of ids) {
            if (!layouts[id]) {
              const offset = nextIndex * CASCADE_OFFSET;
              setLayouts(id, {
                x: 20 + offset,
                y: 20 + offset,
                w: DEFAULT_W,
                h: DEFAULT_H,
              });
            }
            nextIndex++;
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
      reportLayout(id as TerminalId);
    }
    setDragDelta({ x: 0, y: 0 });
  }

  /** Start resizing a tile from the bottom-right corner.
   *  Pointer deltas are in screen-space — normalize by zoom. */
  let resizeAbort: AbortController | null = null;
  function startResize(id: TerminalId, e: PointerEvent) {
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

    resizeAbort?.abort();
    resizeAbort = new AbortController();
    const { signal } = resizeAbort;

    window.addEventListener(
      "pointermove",
      (ev) => {
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
      { signal },
    );
    window.addEventListener(
      "pointerup",
      () => {
        resizeAbort?.abort();
        // Snap size to grid
        const cur = layouts[id];
        if (cur) {
          setLayouts(id, {
            ...cur,
            w: viewport.snapToGrid(cur.w),
            h: viewport.snapToGrid(cur.h),
          });
        }
        reportLayout(id);
      },
      { signal },
    );
  }

  // On mount, center the viewport on all terminals.
  let containerRef!: HTMLDivElement;
  let hasScrolled = false;
  createEffect(() => {
    const ids = props.terminalIds;
    if (ids.length === 0 || hasScrolled) return;
    const allLayouts: TileLayout[] = [];
    for (const id of ids) {
      const l = layouts[id];
      if (l) allLayouts.push(l);
    }
    if (allLayouts.length === 0) return;
    hasScrolled = true;
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
          viewport.setContainerRef(el);
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
          <For each={props.terminalIds}>
            {(id) => (
              <CanvasTile
                id={id}
                parent={props}
                layouts={layouts}
                startResize={startResize}
                zoom={viewport.zoom}
              />
            )}
          </For>
        </div>
      </div>
    </DragDropProvider>
  );
};

/** Single tile on the canvas — separated so createDraggable gets its own
 *  reactive owner per tile (required by solid-dnd). Shell only: positioning,
 *  title bar, resize handle. Terminal rendering delegated to TerminalContent. */
const CanvasTile: Component<{
  id: TerminalId;
  parent: {
    activeId: TerminalId | null;
    getTerminalTheme: (id: TerminalId) => ITheme;
    getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined;
    getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
    onSelect: (id: TerminalId) => void;
    onCloseTerminal: (id: TerminalId) => void;
    onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
    activeMeta: TerminalMetadata | null;
    searchOpen: boolean;
    onSearchOpenChange: (open: boolean) => void;
    subTerminalIds: (id: TerminalId) => TerminalId[];
  };
  layouts: Record<string, TileLayout>;
  startResize: (id: TerminalId, e: PointerEvent) => void;
  zoom: () => number;
}> = (props) => {
  const { id } = props;
  const draggable = createDraggable(id);
  const isActive = () => props.parent.activeId === id;
  const theme = () => props.parent.getTerminalTheme(id);
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

  const themeBg = () => theme().background ?? "var(--color-surface-1)";
  const themeFg = () => theme().foreground ?? "var(--color-fg)";

  return (
    <div
      ref={draggable.ref}
      class="absolute flex flex-col rounded-xl overflow-hidden border transition-shadow duration-200"
      classList={{
        "border-accent/60 shadow-xl": isActive(),
        "border-edge/40 hover:border-edge/60": !isActive(),
      }}
      style={{
        left: `${layout().x}px`,
        top: `${layout().y}px`,
        width: `${layout().w}px`,
        height: `${layout().h}px`,
        "background-color": themeBg(),
        "z-index": isActive() ? 10 : 1,
        opacity: isActive() ? 1 : 0.92,
        "box-shadow": isActive()
          ? `0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--color-accent)`
          : `0 2px 8px rgba(0,0,0,0.2)`,
        // Drag transform is screen-space — divide by zoom so the tile
        // moves at the correct rate in the scaled canvas coordinate system.
        transform: `translate(${draggable.transform.x / props.zoom()}px, ${draggable.transform.y / props.zoom()}px)`,
      }}
      onMouseDown={() => props.parent.onSelect(id)}
    >
      {/* Title bar — uses terminal foreground at low opacity for guaranteed
       *  contrast against the terminal background, regardless of theme. */}
      <div
        class="flex items-center gap-2 px-3 py-1.5 shrink-0 cursor-grab active:cursor-grabbing select-none"
        style={{
          "background-color": `color-mix(in oklch, ${themeFg()} 8%, ${themeBg()})`,
          "border-bottom": `1px solid color-mix(in oklch, ${themeFg()} 12%, ${themeBg()})`,
          // Scope-override fg tier vars so title bar text (TerminalMeta,
          // AgentIndicator) retunes to the terminal theme's foreground.
          // Scoped here (not on the outer tile) so the search bar overlay
          // and other chrome inside the terminal body keep app-level colors.
          "--color-fg": themeFg(),
          "--color-fg-2": `color-mix(in oklch, ${themeFg()} 75%, ${themeBg()})`,
          "--color-fg-3": `color-mix(in oklch, ${themeFg()} 55%, ${themeBg()})`,
        }}
        {...draggable.dragActivators}
      >
        <div class="flex-1 min-w-0">
          <TerminalMeta info={props.parent.getDisplayInfo(id)} />
        </div>
        <button
          class="flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer shrink-0 pointer-events-auto hover:bg-black/20 text-sm"
          style={{
            color: `color-mix(in oklch, ${themeFg()} 50%, ${themeBg()})`,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            props.parent.onCloseTerminal(id);
          }}
          title="Close terminal"
        >
          ×
        </button>
      </div>

      {/* Terminal content — shared with focus mode */}
      <TerminalContent
        terminalId={id}
        visible={true}
        focused={isActive()}
        theme={theme()}
        searchOpen={isActive() && props.parent.searchOpen}
        onSearchOpenChange={props.parent.onSearchOpenChange}
        subTerminalIds={props.parent.subTerminalIds(id)}
        getMetadata={props.parent.getMetadata}
        onCreateSubTerminal={props.parent.onCreateSubTerminal}
        onCloseTerminal={props.parent.onCloseTerminal}
        activeMeta={props.parent.activeMeta}
        onFocus={() => props.parent.onSelect(id)}
      />

      {/* Resize handle — bottom-right corner, larger hit area */}
      <div
        class="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize opacity-0 hover:opacity-100 transition-opacity"
        onPointerDown={(e) => props.startResize(id, e)}
      >
        <span
          class="absolute bottom-0.5 right-0.5"
          style={{
            color: `color-mix(in oklch, ${themeFg()} 40%, ${themeBg()})`,
          }}
        >
          <ResizeGripIcon />
        </span>
      </div>
    </div>
  );
};

export default TerminalCanvas;
