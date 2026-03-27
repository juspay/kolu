import { type Component, Show, createSignal, mergeProps } from "solid-js";
import { shortenCwd } from "./path";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import Tip from "./Tip";
import SettingsPopover from "./SettingsPopover";
import type { WsStatus } from "./rpc";
import type { TerminalMetadata } from "kolu-common";

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
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);
  const [settingsOpen, setSettingsOpen] = createSignal(false);

  return (
    <header class="flex items-center gap-2 px-2 sm:px-4 py-1.5 bg-surface-1 border-b border-edge">
      <Tip label="Toggle sidebar">
        <button
          data-testid="sidebar-toggle"
          class="p-1 text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => props.onToggleSidebar?.()}
        >
          <svg
            class="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M4 6h16M4 12h16M4 18h16"
            />
          </svg>
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
                  <Show when={pr().checks}>
                    {(checks) => (
                      <span
                        class="inline-block w-1.5 h-1.5 rounded-full"
                        classList={{
                          "bg-ok": checks() === "pass",
                          "bg-warning animate-pulse": checks() === "pending",
                          "bg-danger": checks() === "fail",
                        }}
                      />
                    )}
                  </Show>
                  #{pr().number}
                  <span class="truncate hidden sm:inline">{pr().title}</span>
                </a>
              )}
            </Show>
          </span>
        )}
      </Show>
      {/* Push remaining items to the right */}
      <div class="ml-auto flex items-center gap-2">
        {props.themeName && (
          <Tip label="Change theme">
            <button
              data-testid="theme-name"
              class="h-7 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2/50 hover:bg-surface-3/50 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => props.onThemeClick?.()}
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
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>
        </Tip>
        <div class="relative">
          <Tip label="Settings">
            <button
              data-testid="settings-trigger"
              class="h-7 w-7 flex items-center justify-center text-fg-2 hover:text-fg hover:bg-surface-2 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              onClick={() => setSettingsOpen(!settingsOpen())}
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </Tip>
          <SettingsPopover
            open={settingsOpen()}
            onOpenChange={setSettingsOpen}
            randomTheme={props.randomTheme ?? true}
            onRandomThemeChange={(on) => props.onRandomThemeChange?.(on)}
          />
        </div>
        <Tip label="Command palette">
          <button
            data-testid="palette-trigger"
            class="h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded border border-edge-bright transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onOpenPalette?.()}
          >
            <kbd class="font-[inherit] tracking-wide text-[0.65rem] text-fg-3 bg-surface-1 px-1.5 py-0.5 rounded border border-edge shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)]">
              {formatKeybind(SHORTCUTS.commandPalette.keybind)}
            </kbd>
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
