/** TerminalCanvas — freeform 2D canvas where terminals can be dragged
 *  and resized like desktop windows. Two-finger scroll pans the canvas.
 *
 *  Drag uses @thisbeyond/solid-dnd (same library as the sidebar) for
 *  gesture handling — decouples sensing from position application.
 *  Resize uses raw pointer events (resize is not a drag-to-position
 *  gesture, so solid-dnd's model doesn't fit). */

import {
  type Component,
  For,
  Show,
  createEffect,
  createSignal,
  on,
  batch,
} from "solid-js";
import { createStore } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
import {
  DragDropProvider,
  DragDropSensors,
  createDraggable,
  type DragEvent,
} from "@thisbeyond/solid-dnd";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import TerminalMeta from "./TerminalMeta";
import SubPanelTabBar from "./SubPanelTabBar";
import { useSubPanel } from "./useSubPanel";
import type { TerminalDisplayInfo } from "./terminalDisplay";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const DEFAULT_W = 700;
const DEFAULT_H = 500;
const CASCADE_OFFSET = 30;
const MIN_W = 300;
const MIN_H = 200;

type TileLayout = { x: number; y: number; w: number; h: number };

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
  const subPanel = useSubPanel();

  const [layouts, setLayouts] = makePersisted(
    createStore<Record<string, TileLayout>>({}),
    { name: "kolu-canvas-layouts" },
  );

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

  /** Apply captured drag delta to the tile's persisted position. */
  function handleDragEnd({ draggable }: DragEvent) {
    if (!draggable) return;
    const id = draggable.id as string;
    const l = layouts[id];
    if (!l) return;
    const { x: dx, y: dy } = dragDelta();
    if (dx !== 0 || dy !== 0) {
      setLayouts(id, { ...l, x: l.x + dx, y: l.y + dy });
    }
    setDragDelta({ x: 0, y: 0 });
  }

  /** Start resizing a tile from the bottom-right corner.
   *  Resize is not a drag-to-position gesture, so solid-dnd doesn't fit.
   *  Raw pointer events are the right tool here — but we capture the
   *  abort controller for cleanup if the component unmounts mid-resize. */
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
        setLayouts(id, {
          x: origX,
          y: origY,
          w: Math.max(MIN_W, origW + (ev.clientX - startX)),
          h: Math.max(MIN_H, origH + (ev.clientY - startY)),
        });
      },
      { signal },
    );
    window.addEventListener("pointerup", () => resizeAbort?.abort(), {
      signal,
    });
  }

  // Compute canvas size to fit all tiles + padding
  const canvasSize = () => {
    let maxX = 0;
    let maxY = 0;
    for (const id of props.terminalIds) {
      const l = layouts[id];
      if (!l) continue;
      maxX = Math.max(maxX, l.x + l.w + 40);
      maxY = Math.max(maxY, l.y + l.h + 40);
    }
    return { width: Math.max(maxX, 800), height: Math.max(maxY, 600) };
  };

  return (
    <DragDropProvider onDragMove={handleDragMove} onDragEnd={handleDragEnd}>
      <DragDropSensors />
      <div class="flex-1 min-h-0 overflow-auto relative">
        <div
          style={{
            position: "relative",
            "min-width": `${canvasSize().width}px`,
            "min-height": `${canvasSize().height}px`,
          }}
        >
          <For each={props.terminalIds}>
            {(id) => (
              <CanvasTile
                id={id}
                parent={props}
                layouts={layouts}
                setLayouts={setLayouts}
                subPanel={subPanel}
                startResize={startResize}
              />
            )}
          </For>
        </div>
      </div>
    </DragDropProvider>
  );
};

/** Single tile on the canvas — separated so createDraggable gets its own
 *  reactive owner per tile (required by solid-dnd). */
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
  setLayouts: any;
  subPanel: ReturnType<typeof useSubPanel>;
  startResize: (id: TerminalId, e: PointerEvent) => void;
}> = (props) => {
  const { id } = props;
  const draggable = createDraggable(id);
  const isActive = () => props.parent.activeId === id;
  const theme = () => props.parent.getTerminalTheme(id);
  const subIds = () => props.parent.subTerminalIds(id);
  const panelState = () => props.subPanel.getSubPanel(id);
  const hasSubs = () => subIds().length > 0;
  const isExpanded = () => hasSubs() && !panelState().collapsed;
  const activeSubTab = () => panelState().activeSubTab;
  const focusTarget = () => panelState().focusTarget;
  const layout = () =>
    props.layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

  return (
    <div
      ref={draggable.ref}
      class="absolute flex flex-col rounded-xl overflow-hidden border transition-shadow duration-150"
      classList={{
        "border-accent/60 ring-1 ring-accent/30 shadow-lg shadow-accent/10":
          isActive(),
        "border-edge/50 hover:border-edge shadow-md": !isActive(),
      }}
      style={{
        left: `${layout().x}px`,
        top: `${layout().y}px`,
        width: `${layout().w}px`,
        height: `${layout().h}px`,
        "background-color": theme().background ?? "var(--color-surface-1)",
        "z-index": isActive() ? 10 : 1,
        // solid-dnd applies transform during drag via this style
        ...{
          transform: `translate(${draggable.transform.x}px, ${draggable.transform.y}px)`,
        },
      }}
      onMouseDown={() => props.parent.onSelect(id)}
    >
      {/* Title bar — drag handle. Background is derived from the terminal
       *  theme so it stays harmonious with any color scheme. We mix white
       *  into the terminal bg to create a subtle lighter bar. */}
      <div
        class="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 cursor-grab active:cursor-grabbing select-none"
        classList={{
          "border-accent/30": isActive(),
          "border-edge/30": !isActive(),
        }}
        style={{
          "background-color": `color-mix(in oklch, ${theme().background ?? "var(--color-surface-1)"} 85%, white)`,
        }}
        {...draggable.dragActivators}
      >
        <div class="flex-1 min-w-0 pointer-events-none">
          <TerminalMeta info={props.parent.getDisplayInfo(id)} />
        </div>
        <button
          class="flex items-center justify-center w-5 h-5 rounded-full text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer shrink-0 pointer-events-auto"
          onClick={(e) => {
            e.stopPropagation();
            props.parent.onCloseTerminal(id);
          }}
          title="Close terminal"
        >
          ×
        </button>
      </div>

      {/* Terminal body */}
      <div class="flex-1 min-h-0 flex flex-col">
        <div class="flex-1 min-h-0">
          <Terminal
            terminalId={id}
            visible={true}
            focused={isActive() && (!isExpanded() || focusTarget() === "main")}
            theme={theme()}
            searchOpen={isActive() && props.parent.searchOpen}
            onSearchOpenChange={props.parent.onSearchOpenChange}
            onFocus={() => {
              props.parent.onSelect(id);
              props.subPanel.setFocusTarget(id, "main");
            }}
          />
        </div>

        {/* Sub-panel */}
        <Show when={isExpanded()}>
          <div class="border-t border-edge/30">
            <SubPanelTabBar
              subIds={subIds()}
              activeSubTab={activeSubTab()}
              getMetadata={props.parent.getMetadata}
              onSelect={(subId) => props.subPanel.setActiveSubTab(id, subId)}
              onClose={props.parent.onCloseTerminal}
              onCollapse={() => props.subPanel.collapsePanel(id)}
              onCreate={() =>
                props.parent.onCreateSubTerminal(
                  id,
                  props.parent.activeMeta?.cwd,
                )
              }
            />
            <div class="h-40">
              <For each={subIds()}>
                {(subId) => (
                  <Terminal
                    terminalId={subId}
                    visible={activeSubTab() === subId}
                    focused={
                      isActive() &&
                      isExpanded() &&
                      activeSubTab() === subId &&
                      focusTarget() === "sub"
                    }
                    theme={theme()}
                    searchOpen={false}
                    onSearchOpenChange={() => {}}
                    onFocus={() => props.subPanel.setFocusTarget(id, "sub")}
                    isSub
                  />
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>

      {/* Resize handle — bottom-right corner */}
      <div
        class="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        onPointerDown={(e) => props.startResize(id, e)}
      >
        <svg
          class="w-3 h-3 text-fg-3 absolute bottom-0.5 right-0.5"
          viewBox="0 0 12 12"
          fill="currentColor"
        >
          <circle cx="10" cy="10" r="1.2" />
          <circle cx="6" cy="10" r="1.2" />
          <circle cx="10" cy="6" r="1.2" />
        </svg>
      </div>
    </div>
  );
};

export default TerminalCanvas;
