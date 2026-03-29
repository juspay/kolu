import { type Component, Show, createSignal, mergeProps } from "solid-js";
import { shortenCwd } from "./path";
import {
  GridIcon,
  MenuIcon,
  PrStateIcon,
  SearchIcon,
  SettingsIcon,
  WorktreeIcon,
} from "./Icons";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import Kbd from "./Kbd";
import Tip from "./Tip";
import ChecksIndicator from "./ChecksIndicator";
import ClaudeIndicator from "./ClaudeIndicator";
import SettingsPopover from "./SettingsPopover";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";
import type { WsStatus } from "./rpc";
import type { TerminalMetadata } from "kolu-common";
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
  onMissionControl?: () => void;
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
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);
  const { showTipOnce } = useTips();
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <header class="flex items-center gap-2 px-2 sm:px-4 h-10 shrink-0 overflow-hidden bg-surface-1 border-b border-edge">
      <Tip label="Toggle sidebar">
        <button
          data-testid="sidebar-toggle"
          class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => props.onToggleSidebar?.()}
        >
          <MenuIcon />
        </button>
      </Tip>
      <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
      <span class="font-semibold text-sm hidden sm:inline">
        {props.appTitle ?? "kolu"}
      </span>
      <Show when={props.meta}>
        {(meta) => (
          <span
            class="flex items-center gap-1 text-xs min-w-0"
            data-testid="header-cwd"
          >
            <span class="text-fg-2 truncate" title={meta().cwd}>
              {shortenCwd(meta().cwd)}
            </span>
            <Show when={meta().git}>
              {(git) => (
                <span class="text-fg-3 shrink-0" data-testid="header-branch">
                  &middot; {git().branch}
                  <Show when={git().isWorktree}>
                    <WorktreeIcon class="inline w-3 h-3 ml-0.5" />
                  </Show>
                </span>
              )}
            </Show>
            <Show when={meta().pr}>
              {(pr) => (
                <a
                  href={pr().url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-fg-3 hover:text-accent min-w-0 transition-colors"
                  data-testid="header-pr"
                >
                  &middot;
                  <PrStateIcon state={pr().state} class="w-3 h-3" />
                  <Show when={pr().checks}>
                    {(checks) => <ChecksIndicator status={checks()} />}
                  </Show>
                  #{pr().number}
                  <span class="truncate hidden sm:inline">{pr().title}</span>
                </a>
              )}
            </Show>
            <Show when={meta().claude}>
              {(claude) => (
                <span class="shrink-0">
                  &middot; <ClaudeIndicator state={claude().state} />
                </span>
              )}
            </Show>
          </span>
        )}
      </Show>
      {/* Push remaining items to the right */}
      <div class="ml-auto flex items-center gap-2">
        <Tip label="Mission Control">
          <button
            data-testid="mission-control-trigger"
            class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onMissionControl?.()}
          >
            <GridIcon />
          </button>
        </Tip>
        {props.themeName && (
          <Tip label="Change theme">
            <button
              data-testid="theme-name"
              class="h-7 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2/50 hover:bg-surface-3/50 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
            class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onSearch?.()}
          >
            <SearchIcon />
          </button>
        </Tip>
        <div class="relative">
          <Tip label="Settings">
            <button
              data-testid="settings-trigger"
              class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => setSettingsOpen(!settingsOpen())}
            >
              <SettingsIcon />
            </button>
          </Tip>
          <SettingsPopover
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
            randomTheme={props.randomTheme ?? true}
            onRandomThemeChange={(on) => props.onRandomThemeChange?.(on)}
            scrollLock={props.scrollLock ?? true}
            onScrollLockChange={(on) => props.onScrollLockChange?.(on)}
            colorScheme={props.colorScheme ?? "dark"}
            onColorSchemeChange={(s) => props.onColorSchemeChange?.(s)}
            activityAlerts={props.activityAlerts ?? true}
            onActivityAlertsChange={(on) => props.onActivityAlertsChange?.(on)}
            startupTips={props.startupTips ?? true}
            onStartupTipsChange={(on) => props.onStartupTipsChange?.(on)}
          />
        </div>
        <Tip label="Command palette">
          <button
            data-testid="palette-trigger"
            class="h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded border border-edge-bright transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
