/** PanelHost — renders one `PanelSlot` for a tile: tab bar above, active
 *  content below. Owns the right-click "Move to {edge}" menu state.
 *
 *  Layout-side responsibilities (resizing, collapsing, axis) are handled by
 *  the parent `TerminalContent` via `<Resizable>` — this component only
 *  paints the slot's interior. */

import { type Component, createSignal, For, Show } from "solid-js";
import type { ITheme } from "@xterm/xterm";
import {
  ALL_PANEL_EDGES,
  type CodeTabView,
  type PanelEdge,
  type PanelSlot,
  type TerminalId,
  type TerminalMetadata,
} from "kolu-common";
import PanelTabBar from "./PanelTabBar";
import PanelContentRenderer from "./PanelContentRenderer";

const PanelHost: Component<{
  /** The tile this slot is attached to. */
  hostTerminalId: TerminalId;
  /** Which edge this slot occupies — needed so the move menu can hide the
   *  current edge from the destination list. */
  edge: PanelEdge;
  slot: PanelSlot;
  visible: boolean;
  /** Whether this slot is the keyboard-focus target for the tile. */
  focused: boolean;
  theme: ITheme;
  themeName?: string;
  meta: TerminalMetadata | null;
  getMetadata: (id: string) => TerminalMetadata | undefined;
  onSelectTab: (idx: number) => void;
  onCloseTab: (idx: number) => void;
  onAddTab?: () => void;
  onCollapse: () => void;
  onMoveTab: (tabIdx: number, toEdge: PanelEdge) => void;
  onCodeModeChange: (mode: CodeTabView) => void;
  onThemeClick?: () => void;
  onFocus?: () => void;
}> = (props) => {
  const [menu, setMenu] = createSignal<{
    tabIdx: number;
    x: number;
    y: number;
  } | null>(null);

  function openMenu(tabIdx: number, e: MouseEvent) {
    setMenu({ tabIdx, x: e.clientX, y: e.clientY });
  }
  function closeMenu() {
    setMenu(null);
  }

  const activeContent = () => props.slot.tabs[props.slot.active];
  const canAddTab = () =>
    props.slot.tabs.length > 0 &&
    props.slot.tabs[0]!.kind === "terminal" &&
    props.onAddTab !== undefined;

  return (
    <div
      data-testid="panel-host"
      data-edge={props.edge}
      class="flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-surface-0"
    >
      <PanelTabBar
        tabs={props.slot.tabs}
        active={props.slot.active}
        getMetadata={props.getMetadata}
        canAddTab={canAddTab()}
        onSelect={props.onSelectTab}
        onClose={props.onCloseTab}
        onAddTab={props.onAddTab}
        onCollapse={props.onCollapse}
        onContextMenu={openMenu}
      />
      <div class="flex-1 min-h-0 min-w-0 overflow-hidden">
        <Show when={activeContent()}>
          {(content) => (
            <PanelContentRenderer
              hostTerminalId={props.hostTerminalId}
              content={content()}
              focused={props.focused}
              visible={props.visible}
              theme={props.theme}
              themeName={props.themeName}
              meta={props.meta}
              onCodeModeChange={props.onCodeModeChange}
              onThemeClick={props.onThemeClick}
              onFocus={props.onFocus}
            />
          )}
        </Show>
      </div>
      <Show when={menu()}>
        {(m) => (
          <>
            {/* Click-outside / escape catcher — fixed full-screen, transparent. */}
            <div class="fixed inset-0 z-40" onClick={closeMenu} />
            <div
              class="fixed z-50 min-w-[160px] bg-surface-1 border border-edge rounded shadow-lg py-1 text-sm"
              style={{ left: `${m().x}px`, top: `${m().y}px` }}
              onClick={(e) => e.stopPropagation()}
            >
              <For each={ALL_PANEL_EDGES.filter((e) => e !== props.edge)}>
                {(target) => (
                  <button
                    data-testid={`panel-move-${target}`}
                    class="block w-full text-left px-3 py-1.5 text-fg-3 hover:text-fg hover:bg-surface-2 transition-colors cursor-pointer"
                    onClick={() => {
                      props.onMoveTab(m().tabIdx, target);
                      closeMenu();
                    }}
                  >
                    Move to {target}
                  </button>
                )}
              </For>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

export default PanelHost;
