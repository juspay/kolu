import { type Component, Show, mergeProps } from "solid-js";
import { shortenCwd } from "./path";
import { formatKeybind, SHORTCUTS } from "./keyboard";
import type { WsStatus } from "./rpc";
import type { CwdInfo } from "kolu-common";

/** WS connection status indicator colors. */
const statusColors: Record<WsStatus, string> = {
  connecting: "text-yellow-400",
  open: "text-green-400",
  closed: "text-red-400",
};

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
  onThemeClick?: () => void;
  themeName?: string;
  cwd?: CwdInfo | null;
  onToggleSidebar?: () => void;
  onShortcutsHelp?: () => void;
  renderer?: string;
  appTitle?: string;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);

  return (
    <header class="flex items-center gap-2 px-2 sm:px-4 py-2 bg-slate-800 border-b border-slate-700">
      <button
        data-testid="sidebar-toggle"
        class="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors cursor-pointer"
        onClick={() => props.onToggleSidebar?.()}
        title="Toggle sidebar"
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
      <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
      <span class="font-semibold text-sm hidden sm:inline">
        {props.appTitle ?? "kolu"}
      </span>
      <Show when={props.cwd}>
        {(cwdInfo) => (
          <span
            class="text-xs text-slate-400 truncate max-w-[300px]"
            title={cwdInfo().cwd}
            data-testid="header-cwd"
          >
            <Show when={cwdInfo().git} fallback={shortenCwd(cwdInfo().cwd)}>
              {(git) => (
                <>
                  <span class="text-slate-300" data-testid="header-repo">
                    {git().repoName}
                  </span>
                  <span class="text-slate-500 mx-1">:</span>
                  <span data-testid="header-branch">{git().branch}</span>
                  <span class="text-slate-500 mx-1">&middot;</span>
                  {shortenCwd(cwdInfo().cwd)}
                </>
              )}
            </Show>
          </span>
        )}
      </Show>
      {/* Push remaining items to the right */}
      <div class="ml-auto flex items-center gap-2">
        {props.themeName && (
          <button
            data-testid="theme-name"
            class="px-2 py-0.5 text-xs text-slate-400 hover:text-white bg-slate-700/50 hover:bg-slate-600/50 rounded transition-colors cursor-pointer"
            onClick={() => props.onThemeClick?.()}
            title="Change theme"
          >
            {props.themeName}
          </button>
        )}
        <button
          data-testid="palette-trigger"
          class="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded border border-slate-600 transition-colors cursor-pointer"
          onClick={() => props.onOpenPalette?.()}
          title="Command palette"
        >
          <kbd class="font-sans">
            {formatKeybind(SHORTCUTS.commandPalette.keybind)}
          </kbd>
        </button>
        <button
          class="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded border border-slate-600 transition-colors cursor-pointer"
          onClick={() => props.onShortcutsHelp?.()}
          title="Keyboard shortcuts"
        >
          <kbd class="font-sans">
            {formatKeybind(SHORTCUTS.shortcutsHelp.keybind)}
          </kbd>
        </button>
        {props.renderer && (
          <span class="text-xs text-slate-500 hidden sm:inline">
            {props.renderer}
          </span>
        )}
        <span
          class={`text-xs ${statusColors[props.status]}`}
          data-ws-status={props.status}
        >
          ● <span class="hidden sm:inline">{props.status}</span>
        </span>
      </div>
    </header>
  );
};

export default Header;
