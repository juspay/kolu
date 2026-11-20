import type { Component, JSX } from "solid-js";
import type { WsStatus } from "../rpc/rpc";

const identityMarkFrameClass =
  "shrink-0 relative inline-flex h-7 w-7 items-center justify-center rounded-lg leading-none text-fg-2";

/** Hit target for Padi/Kaval icon+dot mark buttons. */
export const identityMarkBtnClass = `${identityMarkFrameClass} pointer-events-auto transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer`;

/** Fixed dual-daemon slot: exactly two mark buttons wide. */
export const dualDaemonSlotClass =
  "flex h-7 w-14 shrink-0 items-center justify-center";

export const IdentityMark: Component<{
  logoSrc: string;
  children: JSX.Element;
  /** Extra class on the logo `<img>`. */
  imgClass?: string;
}> = (props) => (
  <span class="relative grid h-5 w-5 shrink-0 place-items-center">
    <img src={props.logoSrc} alt="" class={`h-4 w-4 ${props.imgClass ?? ""}`} />
    {props.children}
  </span>
);

export const StatusDot: Component<{
  class: string;
  "data-ws-status"?: WsStatus;
  "data-daemon-state"?: string;
  "data-padi-link"?: string;
}> = (props) => (
  <span
    data-ws-status={props["data-ws-status"]}
    data-daemon-state={props["data-daemon-state"]}
    data-padi-link={props["data-padi-link"]}
    class={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-surface-2 ${props.class}`}
  />
);
