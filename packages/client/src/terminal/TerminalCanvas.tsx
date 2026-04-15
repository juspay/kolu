/** TerminalCanvas — freeform 2D canvas where terminals can be dragged
 *  and resized like desktop windows. Two-finger scroll pans the canvas. */

import { type Component, For, Show, createEffect, on } from "solid-js";
import { createStore } from "solid-js/store";
import { makePersisted } from "@solid-primitives/storage";
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
        // Remove layouts for terminals that no longer exist
        for (const key of Object.keys(layouts)) {
          if (!idSet.has(key)) setLayouts(key, undefined!);
        }
        // Assign layouts for new terminals
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
      },
    ),
  );

  /** Start dragging a tile by its title bar. */
  function startDrag(id: TerminalId, e: PointerEvent) {
    e.preventDefault();
    const l = layouts[id];
    if (!l) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = l.x;
    const origY = l.y;
    const origW = l.w;
    const origH = l.h;

    function onMove(ev: PointerEvent) {
      setLayouts(id, {
        x: origX + (ev.clientX - startX),
        y: origY + (ev.clientY - startY),
        w: origW,
        h: origH,
      });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** Start resizing a tile from the bottom-right corner. */
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

    function onMove(ev: PointerEvent) {
      setLayouts(id, {
        x: origX,
        y: origY,
        w: Math.max(300, origW + (ev.clientX - startX)),
        h: Math.max(200, origH + (ev.clientY - startY)),
      });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
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
    <div class="flex-1 min-h-0 overflow-auto relative">
      <div
        style={{
          position: "relative",
          "min-width": `${canvasSize().width}px`,
          "min-height": `${canvasSize().height}px`,
        }}
      >
        <For each={props.terminalIds}>
          {(id) => {
            const isActive = () => props.activeId === id;
            const theme = () => props.getTerminalTheme(id);
            const subIds = () => props.subTerminalIds(id);
            const panelState = () => subPanel.getSubPanel(id);
            const hasSubs = () => subIds().length > 0;
            const isExpanded = () => hasSubs() && !panelState().collapsed;
            const activeSubTab = () => panelState().activeSubTab;
            const focusTarget = () => panelState().focusTarget;
            const layout = () =>
              layouts[id] ?? { x: 0, y: 0, w: DEFAULT_W, h: DEFAULT_H };

            return (
              <div
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
                  "background-color":
                    theme().background ?? "var(--color-surface-1)",
                  "z-index": isActive() ? 10 : 1,
                }}
                onMouseDown={() => props.onSelect(id)}
              >
                {/* Title bar — drag handle */}
                <div
                  class="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 cursor-grab active:cursor-grabbing select-none"
                  classList={{
                    "border-accent/30 bg-accent/5": isActive(),
                    "border-edge/30 bg-surface-1/50": !isActive(),
                  }}
                  onPointerDown={(e) => {
                    props.onSelect(id);
                    startDrag(id, e);
                  }}
                >
                  <div class="flex-1 min-w-0 pointer-events-none">
                    <TerminalMeta info={props.getDisplayInfo(id)} />
                  </div>
                  <button
                    class="flex items-center justify-center w-5 h-5 rounded-full text-fg-3 hover:text-fg hover:bg-surface-3 transition-colors cursor-pointer shrink-0 pointer-events-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onCloseTerminal(id);
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
                      focused={
                        isActive() &&
                        (!isExpanded() || focusTarget() === "main")
                      }
                      theme={theme()}
                      searchOpen={isActive() && props.searchOpen}
                      onSearchOpenChange={props.onSearchOpenChange}
                      onFocus={() => {
                        props.onSelect(id);
                        subPanel.setFocusTarget(id, "main");
                      }}
                    />
                  </div>

                  {/* Sub-panel */}
                  <Show when={isExpanded()}>
                    <div class="border-t border-edge/30">
                      <SubPanelTabBar
                        subIds={subIds()}
                        activeSubTab={activeSubTab()}
                        getMetadata={props.getMetadata}
                        onSelect={(subId) =>
                          subPanel.setActiveSubTab(id, subId)
                        }
                        onClose={props.onCloseTerminal}
                        onCollapse={() => subPanel.collapsePanel(id)}
                        onCreate={() =>
                          props.onCreateSubTerminal(id, props.activeMeta?.cwd)
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
                              onFocus={() => subPanel.setFocusTarget(id, "sub")}
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
                  onPointerDown={(e) => startResize(id, e)}
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
          }}
        </For>
      </div>
    </div>
  );
};

export default TerminalCanvas;
