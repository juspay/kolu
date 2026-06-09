/** TerminalContent — shared terminal rendering: main terminal + resizable
 *  sub-panel with tab bar and child terminals.
 *
 *  Used by CanvasTile (desktop) and MobileTileView (mobile). Owns
 *  sub-panel state internally — callers provide only the shell. */

import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { realSizes } from "../ui/corvuResizable";
import { Z_HANDLE_INNER } from "../ui/stackLayers";
import SubPanelTabBar from "./SubPanelTabBar";
import Terminal from "./Terminal";
import { useSubPanel } from "./useSubPanel";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether this terminal is "active" — controls focus, fit, viewport
   *  publishing. On the canvas: true for all tiles (always rendered);
   *  on mobile: true only for the visible tile. */
  visible: boolean;
  /** Whether this terminal should grab keyboard focus. True only for
   *  the selected tile on the canvas; same as `visible` on mobile. */
  focused: boolean;
  theme: ITheme;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  subTerminalIds: TerminalId[];
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  onCreateSubTerminal: (parentId: TerminalId, cwd?: string) => void;
  onCloseTerminal: (id: TerminalId) => void;
  activeMeta: TerminalMetadata | null;
  /** Called when user focuses any terminal in this pane (click, keyboard).
   *  Canvas mode uses this to set the active tile. */
  onFocus?: () => void;
}> = (props) => {
  const subPanel = useSubPanel();

  const panelState = () => subPanel.getSubPanel(props.terminalId);
  const hasSubs = () => props.subTerminalIds.length > 0;
  const isExpanded = () => hasSubs() && !panelState().collapsed;
  const activeSubTab = () => panelState().activeSubTab;
  const focusTarget = () => panelState().focusTarget;

  const shouldFocusMain = () =>
    props.focused && (!isExpanded() || focusTarget() === "main");
  const shouldFocusSub = (subId: TerminalId) =>
    props.focused &&
    isExpanded() &&
    activeSubTab() === subId &&
    focusTarget() === "sub";

  function handleSizesChange(sizes: number[]) {
    // Persist the bottom panel size when user drags the handle.
    // `realSizes` drops Corvu's degenerate emissions; the inline `> 0.02`
    // gate then ignores the tiny `[1, 0]` values Corvu fires during
    // programmatic transitions (e.g. expand from collapsed), which would
    // immediately re-collapse the panel.
    const s = realSizes(sizes);
    if (s && s[1] > 0.02) {
      subPanel.setPanelSize(props.terminalId, s[1]);
    }
  }

  function handleMainFocus() {
    subPanel.setFocusTarget(props.terminalId, "main");
    props.onFocus?.();
  }

  function handleSubFocus() {
    subPanel.setFocusTarget(props.terminalId, "sub");
    props.onFocus?.();
  }

  return (
    <Resizable
      orientation="vertical"
      sizes={
        isExpanded()
          ? [1 - panelState().panelSize, panelState().panelSize]
          : [1, 0]
      }
      onSizesChange={handleSizesChange}
      class="flex-1 min-h-0"
    >
      <Resizable.Panel as="div" class="min-h-0 overflow-hidden" minSize={0.2}>
        <Terminal
          terminalId={props.terminalId}
          visible={props.visible}
          focused={shouldFocusMain()}
          theme={props.theme}
          searchOpen={props.searchOpen}
          onSearchOpenChange={props.onSearchOpenChange}
          onFocus={handleMainFocus}
        />
      </Resizable.Panel>

      {/* Resize handle — invisible hit zone, visible on hover.
       *  `Z_HANDLE_INNER` mirrors CodeTab.tsx's inner-handle defense:
       *  the ::before pseudo overlaps the previous panel (xterm tile)
       *  by 4px and any positioned descendant inside that panel with
       *  auto/zero z-index would otherwise paint over the hit zone.
       *  The canvas-tile container that hosts this tree creates its
       *  own stacking context (`Z_CANVAS_TILE_ACTIVE`), so external
       *  z-stackers can't intrude — but the defense belongs on the
       *  handle itself so a future xterm overlay with an explicit
       *  z-index doesn't silently break drag-to-resize.
       *  See `ui/stackLayers.ts` for the full layering contract. */}
      <Show when={hasSubs()}>
        <Resizable.Handle
          data-testid="resize-handle"
          class="shrink-0 transition-all"
          classList={{
            "h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors":
              isExpanded(),
            "h-0": !isExpanded(),
          }}
          style={{ "z-index": Z_HANDLE_INNER }}
          aria-label="Resize terminal split"
        />
      </Show>

      <Resizable.Panel
        as="div"
        class="min-h-0 overflow-hidden flex flex-col"
        minSize={0}
        collapsible
        collapsedSize={0}
        onCollapse={() => subPanel.collapsePanel(props.terminalId)}
        onExpand={() => subPanel.expandPanel(props.terminalId)}
      >
        <Show when={isExpanded()}>
          <SubPanelTabBar
            subIds={props.subTerminalIds}
            activeSubTab={activeSubTab()}
            getMetadata={props.getMetadata}
            onSelect={(id) => subPanel.setActiveSubTab(props.terminalId, id)}
            onClose={props.onCloseTerminal}
            onCollapse={() => subPanel.collapsePanel(props.terminalId)}
            onCreate={() =>
              props.onCreateSubTerminal(props.terminalId, props.activeMeta?.cwd)
            }
          />
        </Show>
        <div class="flex-1 min-h-0">
          <For each={props.subTerminalIds}>
            {(subId) => (
              <Terminal
                terminalId={subId}
                visible={
                  props.visible && isExpanded() && activeSubTab() === subId
                }
                focused={shouldFocusSub(subId)}
                theme={props.theme}
                searchOpen={false}
                onSearchOpenChange={() => {}}
                onFocus={handleSubFocus}
                isSub
              />
            )}
          </For>
        </div>
      </Resizable.Panel>
    </Resizable>
  );
};

export default TerminalContent;
