import { type Component, createMemo, Show } from "solid-js";
import { dockExpanded, toggleRailCards } from "./canvas/dock/Dock";
import { useViewPosture } from "./canvas/useViewPosture";
import HostSelectorStrip from "./host/HostSelectorStrip";
import { ACTIONS } from "./input/actions";
import { formatKeybind } from "./input/keyboard";
import ModeControl from "./conductor/ModeControl";
import ConductorTab from "./conductor/ConductorTab";
import { conductorMode } from "./conductor/useConductorMode";
import RecordButton from "./recorder/RecordButton";
import { useRightPanel } from "./right-panel/useRightPanel";
import type { WsStatus } from "./rpc/rpc";
import SettingsPopover from "./settings/SettingsPopover";
import { setSettingsOpen, settingsOpen } from "./settings/useSettingsOpen";
import { DockToggleIcon, InspectorToggleIcon, SettingsIcon } from "./ui/Icons";
import IdentityRail from "./ui/IdentityRail";
import Kbd from "./ui/Kbd";
import Tip from "./ui/Tip";

const toggleBtnClass =
  "pointer-events-auto hidden sm:flex items-center justify-center w-7 h-7 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const ChromeBar: Component<{
  status: WsStatus;
  onOpenPalette: () => void;
}> = (props) => {
  const rightPanel = useRightPanel();
  const posture = useViewPosture();
  let settingsTriggerRef!: HTMLButtonElement;

  const maximized = createMemo(() => posture.layout() === "maximized");

  return (
    <header
      data-testid="chrome-bar"
      data-maximized={maximized() ? "" : undefined}
      class="chrome-bar-surface relative z-50 flex h-10 shrink-0 items-stretch gap-3 bg-surface-0 px-3 pt-2 pb-0 select-none pointer-events-auto transition-colors duration-150"
    >
      <div class="flex h-8 shrink-0 items-center pointer-events-auto">
        <IdentityRail status={props.status} />
      </div>

      <div class="flex shrink-0 items-end pointer-events-none">
        <ConductorTab />
      </div>

      <div class="flex-1 min-w-0 flex items-end pointer-events-none">
        <HostSelectorStrip />
      </div>

      <div class="-mt-2 flex h-10 items-center gap-2 shrink-0">
        <RecordButton />
        <Show when={!conductorMode()}>
          <ModeControl />
          <Tip
            label={`Toggle dock (${formatKeybind(ACTIONS.toggleDock.keybind)})`}
          >
            <button
              type="button"
              data-testid="dock-toggle"
              class={toggleBtnClass}
              classList={{
                "bg-surface-2 text-fg": dockExpanded(),
                "text-fg-3 hover:bg-surface-2 hover:text-fg": !dockExpanded(),
              }}
              data-active={dockExpanded() ? "" : undefined}
              onClick={toggleRailCards}
              aria-label="Toggle dock"
            >
              <DockToggleIcon active={dockExpanded()} />
            </button>
          </Tip>
          <Tip
            label={`${ACTIONS.toggleRightPanel.label} (${formatKeybind(ACTIONS.toggleRightPanel.keybind)})`}
          >
            <button
              type="button"
              data-testid="inspector-toggle"
              class={toggleBtnClass}
              classList={{
                "bg-surface-2 text-fg": rightPanel.panelOpen(),
                "text-fg-3 hover:bg-surface-2 hover:text-fg":
                  rightPanel.hasTerminals() && !rightPanel.panelOpen(),
                "text-fg-3/40 cursor-not-allowed": !rightPanel.hasTerminals(),
              }}
              data-active={rightPanel.panelOpen() ? "" : undefined}
              disabled={!rightPanel.hasTerminals()}
              onClick={() => rightPanel.togglePanel()}
              aria-label={ACTIONS.toggleRightPanel.label}
            >
              <InspectorToggleIcon active={rightPanel.panelOpen()} />
            </button>
          </Tip>
        </Show>
        <div class="pointer-events-auto">
          <Tip label="Settings">
            <button
              type="button"
              ref={settingsTriggerRef}
              data-testid="settings-trigger"
              class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => setSettingsOpen(!settingsOpen())}
            >
              <SettingsIcon />
            </button>
          </Tip>
          <SettingsPopover
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
            triggerRef={settingsTriggerRef}
          />
        </div>
        <Tip label="Command palette">
          <button
            type="button"
            data-testid="palette-trigger"
            class="pointer-events-auto h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded-lg border border-edge transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette()}
          >
            <Kbd>{formatKeybind(ACTIONS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
      </div>
    </header>
  );
};

export default ChromeBar;
