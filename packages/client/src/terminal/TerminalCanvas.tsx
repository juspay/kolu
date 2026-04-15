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
      <div class="flex-1 min-h-0 overflow-auto relative canvas-grid-bg">
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

  const themeBg = () => theme().background ?? "var(--color-surface-1)";
  const themeFg = () => theme().foreground ?? "var(--color-fg)";

  return (
    <div
      ref={draggable.ref}
      class="absolute flex flex-col rounded-xl overflow-hidden border transition-all duration-200"
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
        transform: `translate(${draggable.transform.x}px, ${draggable.transform.y}px)`,
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
        }}
        {...draggable.dragActivators}
      >
        <div class="flex-1 min-w-0 pointer-events-none">
          <TerminalMeta info={props.parent.getDisplayInfo(id)} />
        </div>
        <button
          class="flex items-center justify-center w-5 h-5 rounded-full transition-colors cursor-pointer shrink-0 pointer-events-auto"
          style={{
            color: `color-mix(in oklch, ${themeFg()} 50%, ${themeBg()})`,
          }}
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

      {/* Resize handle — bottom-right corner, larger hit area */}
      <div
        class="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize opacity-0 hover:opacity-100 transition-opacity"
        onPointerDown={(e) => props.startResize(id, e)}
      >
        <svg
          class="w-3.5 h-3.5 absolute bottom-0.5 right-0.5"
          viewBox="0 0 14 14"
          style={{
            color: `color-mix(in oklch, ${themeFg()} 40%, ${themeBg()})`,
          }}
          fill="currentColor"
        >
          <circle cx="12" cy="12" r="1.3" />
          <circle cx="8" cy="12" r="1.3" />
          <circle cx="12" cy="8" r="1.3" />
          <circle cx="4" cy="12" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12" cy="4" r="1.3" />
        </svg>
      </div>
    </div>
  );
};

export default TerminalCanvas;
