import { type Component, Show, mergeProps } from "solid-js";
import { shortenCwd } from "./path";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import Tip from "./Tip";
import type { WsStatus } from "./rpc";
import type { CwdInfo } from "kolu-common";

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
  cwd?: CwdInfo | null;
  onToggleSidebar?: () => void;
  onShortcutsHelp?: () => void;
  onSearch?: () => void;
  renderer?: string;
  appTitle?: string;
  randomTheme?: boolean;
  onRandomThemeChange?: (on: boolean) => void;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);

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
      {__KOLU_COMMIT__ !== "dev" ? (
        <a
          href={`https://github.com/juspay/kolu/commit/${__KOLU_COMMIT__}`}
          target="_blank"
          rel="noopener noreferrer"
          class="text-xs text-fg-3 hover:text-accent transition-colors"
        >
          {__KOLU_COMMIT__}
        </a>
      ) : (
        <span class="text-xs text-fg-3">dev</span>
      )}
      <Show when={props.cwd}>
        {(cwdInfo) => (
          <span
            class="flex items-center gap-1 text-xs min-w-0"
            data-testid="header-cwd"
          >
            <span class="text-fg-2 truncate" title={cwdInfo().cwd}>
              {shortenCwd(cwdInfo().cwd)}
            </span>
            <Show when={cwdInfo().git}>
              {(git) => (
                <span class="text-fg-3 shrink-0" data-testid="header-branch">
                  &middot; {git().branch}
                </span>
              )}
            </Show>
          </span>
        )}
      </Show>
      <span class="text-xs text-fg-3 hidden sm:inline">
        <kbd class="font-[inherit] text-[0.65rem] text-fg-3 bg-surface-1 px-1.5 py-0.5 rounded border border-edge shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)]">
          Ctrl+`
        </kbd>{" "}
        sub-terminal
      </span>
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
        <Tip label="Random theme for new terminals">
          <button
            data-testid="random-theme-toggle"
            class="h-7 px-2 text-xs rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            classList={{
              "bg-accent/20 ring-1 ring-accent/40": props.randomTheme,
              "text-fg-3 bg-surface-2/50 hover:text-fg-2 opacity-50":
                !props.randomTheme,
            }}
            onClick={() => props.onRandomThemeChange?.(!props.randomTheme)}
          >
            <span class="text-[0.7rem]">🎲</span>
          </button>
        </Tip>
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
        <Tip label="Keyboard shortcuts">
          <button
            class="h-7 flex items-center gap-1.5 px-2 text-xs text-fg-2 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded border border-edge-bright transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onClick={() => props.onShortcutsHelp?.()}
          >
            <kbd class="font-[inherit] tracking-wide text-[0.65rem] text-fg-3 bg-surface-1 px-1.5 py-0.5 rounded border border-edge shadow-[inset_0_-1px_0_rgba(0,0,0,0.3)]">
              {formatKeybind(SHORTCUTS.shortcutsHelp.keybind)}
            </kbd>
          </button>
        </Tip>
        {props.renderer && (
          <span class="text-xs text-fg-3 hidden sm:inline">
            {props.renderer}
          </span>
        )}
        {/* Status dot — replaces text ● with styled element */}
        <div class="flex items-center gap-1.5" data-ws-status={props.status}>
          <span
            class={`inline-block w-2 h-2 rounded-full transition-colors ${statusStyles[props.status]}`}
          />
          <span class="text-xs text-fg-3 hidden sm:inline">{props.status}</span>
        </div>
      </div>
    </header>
  );
};

export default Header;
