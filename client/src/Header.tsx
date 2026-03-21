import type { Component } from "solid-js";

/** WS connection status indicator colors. */
const statusColors = {
  connecting: "text-yellow-400",
  open: "text-green-400",
  closed: "text-red-400",
} as const;

export type WsStatus = keyof typeof statusColors;

const Header: Component<{ status?: WsStatus }> = (props) => {
  const status = () => props.status ?? "connecting";

  return (
    <header class="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
      <span class="text-lg">🪔</span>
      <span class="font-semibold text-sm">kolu</span>
      <span class={`ml-auto text-xs ${statusColors[status()]}`}>
        ● {status()}
      </span>
    </header>
  );
};

export default Header;
