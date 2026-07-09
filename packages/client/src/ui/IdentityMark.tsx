/** Shared identity mark for every process chip in the header — Kolu
 *  (`IdentityRail`) and per-host Padi/Kaval (`HostDaemonChips`).
 *
 *  ONE size: logo + status dot, sized for an `h-7` chrome row. ONE hit-target
 *  class for the clickable wrapper so Kolu and the dual-daemon marks can't
 *  drift (the inconsistency that made Kolu's padded pill look bigger than
 *  the host-chip icons). */

import type { Component, JSX } from "solid-js";
import type { WsStatus } from "../rpc/rpc";

const identityMarkFrameClass =
  "shrink-0 relative inline-flex h-7 w-7 items-center justify-center rounded-lg leading-none text-fg-2";

/** Hit target for an icon+dot mark button — Kolu, Padi, Kaval. Square `h-7 w-7`
 *  so every process mark in the chrome bar is the same size. */
export const identityMarkBtnClass = `${identityMarkFrameClass} pointer-events-auto transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer`;

/** Same frame without button affordance, for decorative process marks inside a
 *  larger clickable row. */
export const identityMarkStaticClass = identityMarkFrameClass;

/** Fixed dual-daemon slot: exactly two mark buttons wide (`w-7` × 2). */
export const dualDaemonSlotClass =
  "flex h-7 w-14 shrink-0 items-center justify-center";

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
