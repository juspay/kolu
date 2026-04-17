/** TerminalContent — shared terminal rendering: main terminal + resizable
 *  sub-panel with tab bar and child terminals.
 *
 *  Used by both TerminalPane (focus mode) and CanvasTile (canvas mode).
 *  Owns sub-panel state internally — callers provide only the shell. */

import { type Component, Show, For, createMemo } from "solid-js";
import Resizable from "@corvu/resizable";
import type { ITheme } from "@xterm/xterm";
import Terminal from "./Terminal";
import SubPanelTabBar from "./SubPanelTabBar";
import { useSubPanel } from "./useSubPanel";
import type { TerminalId, TerminalMetadata } from "kolu-common";

const TerminalContent: Component<{
  terminalId: TerminalId;
  /** Whether this terminal is "active" — controls focus, fit, viewport publishing.
   *  In focus mode: true only for the selected terminal.
   *  In canvas mode: true for all (always rendered). */
  visible: boolean;
  /** Whether this terminal should grab keyboard focus.
   *  In focus mode: same as visible (active terminal gets focus).
   *  In canvas mode: true only for the selected tile. */
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

  /** Hoisted to avoid Solid's JSX-inline-ternary compiler transform — see
   *  `RightPanelLayout.tsx` for the full explanation. `@corvu/resizable`
   *  reads `props.sizes` inside `untrack`, so an inline ternary here leaks
   *  a fresh memo on every read. */
  const sizes = createMemo(() =>
    isExpanded()
      ? [1 - panelState().panelSize, panelState().panelSize]
      : [1, 0],
  );

  function handleSizesChange(sizes: number[]) {
    // Persist the bottom panel size when user drags the handle.
    // Ignore tiny values — the Resizable fires onSizesChange with [1, 0]
    // during programmatic transitions (e.g. expand from collapsed), which
    // would immediately re-collapse the panel.
    if (sizes[1] !== undefined && sizes[1] > 0.02) {
      subPanel.setPanelSize(props.terminalId, sizes[1]);
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
      sizes={sizes()}
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

      {/* Resize handle — invisible hit zone, visible on hover */}
      <Show when={hasSubs()}>
        <Resizable.Handle
          data-testid="resize-handle"
          class="shrink-0 transition-all"
          classList={{
            "h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors":
              isExpanded(),
            "h-0": !isExpanded(),
          }}
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
