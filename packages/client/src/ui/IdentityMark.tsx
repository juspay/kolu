/** Shared identity mark geometry for process icons in the header — Kolu
 *  (`IdentityRail`) uses the artwork only; per-host Padi/Kaval use the button
 *  wrapper below.
 *
 *  ONE size: logo + status dot, sized for an `h-7` chrome row. */

import type { Component, JSX } from "solid-js";
import type { WsStatus } from "../rpc/rpc";

const identityMarkFrameClass =
  "shrink-0 relative inline-flex h-7 w-7 items-center justify-center rounded-lg leading-none text-fg-2";

/** Hit target for Padi/Kaval icon+dot mark buttons. Square `h-7 w-7` so both
 *  daemon marks in the chrome bar are the same size. */
export const identityMarkBtnClass = `${identityMarkFrameClass} pointer-events-auto transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer`;

/** Fixed dual-daemon slot: exactly two mark buttons wide (`w-7` × 2). Used by
 *  the diagnostics popover's padi·kaval pair (not the strip chips). */
export const dualDaemonSlotClass =
  "flex h-7 w-14 shrink-0 items-center justify-center";

export const IdentityMark: Component<{
  logoSrc: string;
  children: JSX.Element;
  /** Extra class on the logo `<img>` — host daemon marks pass
   *  `host-daemon-logo`; Kolu brand mark in `IdentityRail` passes nothing. */
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
