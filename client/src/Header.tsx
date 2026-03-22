import { type Component, mergeProps } from "solid-js";
import { isMac } from "./platform";
import type { ChromeColors } from "./theme";

/** WS connection status indicator colors (hardcoded — visible on both light and dark). */
const statusColors = {
  connecting: "#ca8a04", // yellow-600
  open: "#16a34a", // green-600
  closed: "#dc2626", // red-600
} as const;

export type WsStatus = keyof typeof statusColors;

const Header: Component<{
  status?: WsStatus;
  onOpenPalette?: () => void;
  themeName?: string;
  chrome?: ChromeColors;
}> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);

  return (
    <header
      class="flex items-center gap-2 px-4 py-2"
      style={{
        "background-color": props.chrome?.surface,
        "border-bottom": `1px solid ${props.chrome?.border}`,
      }}
    >
      <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
      <span class="font-semibold text-sm">kolu</span>
      {props.themeName && (
        <span class="text-xs" style={{ color: props.chrome?.textMuted }}>
          {props.themeName}
        </span>
      )}
      <button
        data-testid="palette-trigger"
        class="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs rounded transition-colors cursor-pointer"
        style={{
          color: props.chrome?.textMuted,
          "background-color": props.chrome?.hoverBg,
          border: `1px solid ${props.chrome?.border}`,
        }}
        onClick={() => props.onOpenPalette?.()}
        title="Command palette"
      >
        <kbd class="font-sans">{isMac ? "⌘K" : "Ctrl+K"}</kbd>
      </button>
      <span
        class="text-xs"
        data-ws-status={props.status}
        style={{ color: statusColors[props.status] }}
      >
        ● {props.status}
      </span>
    </header>
  );
};

export default Header;
