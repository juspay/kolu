/** The identity-chip mark shared by every process chip in the header — the Kolu
 *  chip (`IdentityRail`) and the per-host Padi/Kaval sub-chips (`HostDaemonChips`,
 *  nested inside the active host chip since the W4 header redesign). One logo +
 *  one status dot, sized to sit inside an `h-7` chip row. Kept as the SOLE mark
 *  component so a chip's dot styling can't drift between the Kolu chip and the
 *  per-host daemon chips it used to sit beside. */

import type { Component, JSX } from "solid-js";
import type { WsStatus } from "../rpc/rpc";

export const IdentityMark: Component<{
  logoSrc: string;
  children: JSX.Element;
}> = (props) => (
  <span class="relative grid h-5 w-5 shrink-0 place-items-center">
    <img src={props.logoSrc} alt="" class="h-4 w-4" />
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
