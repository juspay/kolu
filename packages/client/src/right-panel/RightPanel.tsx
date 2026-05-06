/** RightPanel — right panel shell with tabbed navigation.
 *  Routes between Inspector and Code tabs via the DU view exposed by
 *  `useRightPanel().activeTab()`. */

import type { RightPanelTabKind, TerminalMetadata } from "kolu-common/surface";
import { type Component, For } from "solid-js";
import { CHROME_ICON_BUTTON_CLASS } from "../ui/chromeSpacing";
import { ChevronRightIcon } from "../ui/Icons";
import { ACTIVE_TERMINAL_ACCENT } from "./activeTerminalAccent";
import CodeTab from "./CodeTab";
import MetadataInspector from "./MetadataInspector";
import { useRightPanel } from "./useRightPanel";

/** Ordered tab kinds shown in the tab bar. Adding a new kind to the
 *  discriminated union requires a corresponding entry here AND in
 *  `TAB_LABEL` below — both are typed `Record<RightPanelTabKind, …>` and
 *  fail-compile on missing keys. The body renderer further down takes a
 *  matching wrapper div per kind; that part is checked at review time. */
const TAB_KINDS: readonly RightPanelTabKind[] = ["inspector", "code"] as const;

const TAB_LABEL: Record<RightPanelTabKind, string> = {
  inspector: "Inspector",
  code: "Code",
};

const RightPanel: Component<{
  meta: TerminalMetadata | null;
  onToggle: () => void;
  themeName?: string;
  onThemeClick?: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();

  const showKind = (kind: RightPanelTabKind) =>
    kind === "inspector" ? rightPanel.showInspector() : rightPanel.showCode();

  return (
    <div
      data-testid="right-panel"
      class="flex flex-col h-full min-w-0 overflow-hidden bg-surface-0 border-l border-edge"
      // Panel stays mounted across the collapse toggle so CodeTab's local
      // state survives (#818); RightPanelLayout shrinks it to ~0 width via
      // Resizable `sizes=[1,0]`. `aria-hidden` makes the contract legible
      // and keeps assistive tech in sync with the visual collapse.
      aria-hidden={rightPanel.collapsed()}
    >
      {/* Tab bar */}
      <div class="flex items-center h-8 shrink-0 bg-surface-1 border-b border-edge">
        <For each={TAB_KINDS}>
          {(kind) => {
            const isActive = () => rightPanel.activeTab().kind === kind;
            return (
              <button
                type="button"
                data-testid={`right-panel-tab-${kind}`}
                data-active={isActive()}
                class={`h-full px-3 text-xs cursor-pointer transition-colors ${
                  isActive()
                    ? "font-medium text-fg-2 bg-surface-0 border-b-2"
                    : "text-fg-3/50 hover:text-fg-2 hover:bg-surface-0/50 border-b-2 border-transparent"
                }`}
                style={{
                  "border-bottom-color": isActive()
                    ? ACTIVE_TERMINAL_ACCENT
                    : undefined,
                }}
                onClick={() => showKind(kind)}
              >
                {TAB_LABEL[kind]}
              </button>
            );
          }}
        </For>
        <div class="flex-1" />
        <div class="flex items-center gap-0.5 pr-1">
          <button
            type="button"
            class={`${CHROME_ICON_BUTTON_CLASS} text-fg-3/70 hover:text-fg-2 hover:bg-surface-0/50`}
            onClick={props.onToggle}
            aria-label="Collapse panel"
          >
            <ChevronRightIcon class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {/* Both tabs are always rendered; the inactive one is display:none.
       *  Mounting both keeps each tab's local state (CodeTab's selected file,
       *  Pierre's tree expansion, scroll position) alive across tab switches
       *  — a `match()` swap would unmount the inactive sibling and discard
       *  it. TAB_KINDS / TAB_LABEL above already give compile-time
       *  exhaustiveness over RightPanelTabKind, so adding a new tab kind
       *  fails to compile there before reaching this renderer. */}
      <div class="flex-1 min-h-0 overflow-hidden">
        <div
          class={
            rightPanel.activeTab().kind === "inspector" ? "h-full" : "hidden"
          }
          aria-hidden={rightPanel.activeTab().kind !== "inspector"}
        >
          <MetadataInspector
            meta={props.meta}
            themeName={props.themeName}
            onThemeClick={props.onThemeClick}
          />
        </div>
        <div
          class={rightPanel.activeTab().kind === "code" ? "h-full" : "hidden"}
          aria-hidden={rightPanel.activeTab().kind !== "code"}
        >
          <CodeTab meta={props.meta} />
        </div>
      </div>
    </div>
  );
};

export default RightPanel;
