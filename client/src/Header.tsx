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

/** WS connection status indicator colors and animations. */
const statusStyles: Record<WsStatus, string> = {
  connecting: "bg-warning animate-pulse",
  open: "bg-ok",
  closed: "bg-danger",
};

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
  onThemeClick?: () => void;
  themeName?: string;
  meta?: TerminalMetadata | null;
  onToggleSidebar?: () => void;
  onSearch?: () => void;
  appTitle?: string;
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
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);
  const { showTipOnce } = useTips();
  let settingsTriggerRef!: HTMLButtonElement;
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <header class="flex items-center h-10 shrink-0 bg-surface-1 border-b border-edge">
      {/* Zone A: Identity — rigid, never compresses */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
        <Tip label="Toggle sidebar">
          <button
            data-testid="sidebar-toggle"
            class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
      {/* Zone B: Spacer + agent status — CWD/branch/PR details live in the inspector panel */}
      <div class="flex-1 min-w-0 flex items-center gap-1 px-2">
        <Show when={props.meta?.agent}>
          {(agent) => <AgentIndicator agent={agent()} />}
        </Show>
      </div>
      {/* Zone C: Controls — rigid, never clips */}
      <div class="flex items-center gap-2 px-2 sm:px-4 shrink-0">
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
