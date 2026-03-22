import { type Component, mergeProps } from "solid-js";

/** WS connection status indicator colors. */
const statusColors = {
  connecting: "text-yellow-400",
  open: "text-green-400",
  closed: "text-red-400",
} as const;

export type WsStatus = keyof typeof statusColors;

const Header: Component<{ status?: WsStatus }> = (rawProps) => {
  const props = mergeProps({ status: "connecting" as const }, rawProps);

  return (
    <header class="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
      <img src="/favicon.svg" alt="kolu" class="w-5 h-5" />
      <span class="font-semibold text-sm">kolu</span>
      <span
        class={`ml-auto text-xs ${statusColors[props.status]}`}
        data-ws-status={props.status}
      >
        ● {props.status}
      </span>
    </header>
  );
};

export default Header;
