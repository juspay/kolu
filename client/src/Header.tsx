import { type Component, Show, mergeProps } from "solid-js";
import { isMac } from "./platform";
import type { WsStatus } from "./rpc";

/** WS connection status indicator colors. */
const statusColors: Record<WsStatus, string> = {
  connecting: "text-yellow-400",
  open: "text-green-400",
  closed: "text-red-400",
};

/** Replace home directory prefix with ~ for compact display. */
function shortenCwd(cwd: string): string {
  // Heuristic: /home/<user>/... or /root/... → ~/...
  const shortened = cwd.replace(/^\/(home\/[^/]+|root)(\/|$)/, "~$2");
  return shortened || "~";
}

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
  onThemeClick?: () => void;
  themeName?: string;
  cwd?: string | null;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);

  return (
    <header class="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
      <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
      <span class="font-semibold text-sm">kolu</span>
      <Show when={props.cwd}>
        {(cwd) => (
          <span
            class="text-xs text-slate-400 truncate max-w-[300px]"
            title={cwd()}
            data-testid="header-cwd"
          >
            {shortenCwd(cwd())}
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
          <kbd class="font-sans">{isMac ? "⌘K" : "Ctrl+K"}</kbd>
        </button>
        <span
          class={`text-xs ${statusColors[props.status]}`}
          data-ws-status={props.status}
        >
          ● {props.status}
        </span>
      </div>
    </header>
  );
};

export default Header;
