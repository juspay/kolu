/** Header — unified app bar with identity, agent status, panel toggles, and controls.
 *  Burger is mobile-only; panel toggles are desktop-only. */

import { type Component, Show, createSignal, mergeProps } from "solid-js";
import { MenuIcon, SearchIcon, SettingsIcon } from "./Icons";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import Kbd from "./Kbd";
import Tip from "./Tip";
import AgentIndicator from "./AgentIndicator";
import SettingsPopover from "./SettingsPopover";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";
import type { WsStatus } from "./rpc";
import type { SidebarAgentPreviews, TerminalMetadata } from "kolu-common";
import type { ColorScheme } from "./useColorScheme";

/** WS connection status indicator colors. */
const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
  meta?: TerminalMetadata | null;
  onToggleSidebar?: () => void;
  onAgentClick?: () => void;
  onSearch?: () => void;
  appTitle?: string;
  // Settings
  randomTheme?: boolean;
  onRandomThemeChange?: (on: boolean) => void;
  scrollLock?: boolean;
  onScrollLockChange?: (on: boolean) => void;
  colorScheme?: ColorScheme;
  onColorSchemeChange?: (scheme: ColorScheme) => void;
  startupTips?: boolean;
  onStartupTipsChange?: (on: boolean) => void;
  activityAlerts?: boolean;
  onActivityAlertsChange?: (on: boolean) => void;
  sidebarAgentPreviews?: SidebarAgentPreviews;
  onSidebarAgentPreviewsChange?: (mode: SidebarAgentPreviews) => void;
  // Theme
  themeName?: string;
  onThemeClick?: () => void;
  // Panel toggles
  sidebarOpen?: boolean;
  hasSubPanel?: boolean;
  subPanelExpanded?: boolean;
  onToggleSubPanel?: () => void;
  rightPanelCollapsed?: boolean;
  onToggleRightPanel?: () => void;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);
  const { showTipOnce } = useTips();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <header class="flex items-center h-10 shrink-0 bg-surface-1 border-b border-edge">
      {/* Zone A: Identity — burger is mobile-only */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        <Tip label="Toggle sidebar">
          <button
            data-testid="sidebar-toggle"
            class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer sm:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onToggleSidebar?.()}
          >
            <MenuIcon />
          </button>
        </Tip>
        <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
        <span class="font-semibold text-sm hidden sm:inline">
          {props.appTitle ?? "kolu"}
        </span>
      </div>

      {/* Zone B: Agent status — click opens inspector panel */}
      <div class="flex-1 min-w-0 flex items-center gap-1 px-2">
        <Show when={props.meta?.agent}>
          {(agent) => (
            <button
              class="cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => props.onAgentClick?.()}
            >
              <AgentIndicator agent={agent()} />
            </button>
          )}
        </Show>
      </div>

      {/* Zone C: Panel toggles → Theme → Search → Settings → ⌘K → Connection dot */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        {/* Panel toggle icons — desktop only */}
        <div class="hidden sm:flex items-center gap-0.5">
          <Tip
            label={`Toggle sidebar (${formatKeybind(SHORTCUTS.commandPalette.keybind)})`}
          >
            <button
              data-testid="sidebar-toggle-desktop"
              class="flex items-center justify-center w-6 h-6 rounded hover:bg-surface-2 text-fg-3 hover:text-fg transition-colors cursor-pointer"
              classList={{ "text-fg-2": props.sidebarOpen }}
              onClick={() => props.onToggleSidebar?.()}
              aria-label="Toggle sidebar"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </Tip>
          <Tip
            label={`Toggle split (${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)})`}
          >
            <button
              class="flex items-center justify-center w-6 h-6 rounded hover:bg-surface-2 text-fg-3 hover:text-fg transition-colors cursor-pointer"
              classList={{
                "text-fg-2": props.hasSubPanel && props.subPanelExpanded,
              }}
              onClick={() => props.onToggleSubPanel?.()}
              aria-label="Toggle terminal split"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="15" x2="21" y2="15" />
              </svg>
            </button>
          </Tip>
          <Tip
            label={`Toggle inspector (${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)})`}
          >
            <button
              class="flex items-center justify-center w-6 h-6 rounded hover:bg-surface-2 text-fg-3 hover:text-fg transition-colors cursor-pointer"
              classList={{ "text-fg-2": !props.rightPanelCollapsed }}
              onClick={() => props.onToggleRightPanel?.()}
              aria-label="Toggle inspector panel"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                stroke-width="2"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="15" y1="3" x2="15" y2="21" />
              </svg>
            </button>
          </Tip>
        </div>
        {props.themeName && (
          <Tip label={`Theme: ${props.themeName}`}>
            <button
              data-testid="theme-name"
              class="h-7 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2/50 hover:bg-surface-3/50 rounded-lg transition-colors cursor-pointer max-w-[14ch] truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => {
                props.onThemeClick?.();
                setTimeout(
                  () => showTipOnce(CONTEXTUAL_TIPS.themeFromPalette),
                  500,
                );
              }}
            >
              {props.themeName}
            </button>
          </Tip>
        )}
        <Tip
          label={`Find in terminal (${formatKeybind(SHORTCUTS.findInTerminal.keybind)})`}
        >
          <button
            class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onSearch?.()}
          >
            <SearchIcon />
          </button>
        </Tip>
        <div>
          <Tip label="Settings">
            <button
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
            randomTheme={props.randomTheme ?? true}
            onRandomThemeChange={(on) => props.onRandomThemeChange?.(on)}
            scrollLock={props.scrollLock ?? true}
            onScrollLockChange={(on) => props.onScrollLockChange?.(on)}
            colorScheme={props.colorScheme ?? "dark"}
            onColorSchemeChange={(s) => props.onColorSchemeChange?.(s)}
            activityAlerts={props.activityAlerts ?? true}
            onActivityAlertsChange={(on) => props.onActivityAlertsChange?.(on)}
            sidebarAgentPreviews={props.sidebarAgentPreviews ?? "attention"}
            onSidebarAgentPreviewsChange={(mode) =>
              props.onSidebarAgentPreviewsChange?.(mode)
            }
            startupTips={props.startupTips ?? true}
            onStartupTipsChange={(on) => props.onStartupTipsChange?.(on)}
          />
        </div>
        <Tip label="Command palette">
          <button
            data-testid="palette-trigger"
            class="h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded-lg border border-edge transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette?.()}
          >
            <Kbd>{formatKeybind(SHORTCUTS.commandPalette.keybind)}</Kbd>
          </button>
        </Tip>
        <Tip label="Connection status">
          <div class="flex items-center gap-1.5" data-ws-status={props.status}>
            <span
              class={`inline-block w-2 h-2 rounded-full transition-colors ${statusStyles[props.status]}`}
            />
          </div>
        </Tip>
      </div>
    </header>
  );
};

export default Header;
