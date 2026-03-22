import { type Component, mergeProps } from "solid-js";
import { isMac } from "./platform";

/** WS connection status indicator colors. */
const statusColors = {
  connecting: "text-yellow-400",
  open: "text-green-400",
  closed: "text-red-400",
} as const;

export type WsStatus = keyof typeof statusColors;

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);

  return (
    <header class="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
      <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
      <span class="font-semibold text-sm">kolu</span>
      <button
        data-testid="palette-trigger"
        class="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded border border-slate-600 transition-colors cursor-pointer"
        onClick={() => props.onOpenPalette?.()}
        title="Command palette"
      >
        <kbd class="font-sans">{isMac ? "⌘" : "Ctrl+"}K</kbd>
      </button>
      <span
        class={`text-xs ${statusColors[props.status]}`}
        data-ws-status={props.status}
      >
        ● {props.status}
      </span>
    </header>
  );
};

export default Header;
