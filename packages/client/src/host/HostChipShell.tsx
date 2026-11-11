/** HostChipShell — the data-free geometry a host tab is made of, shared by the
 *  live chip (`HostSelectorStrip`'s `HostChip`) and the hidden measuring twin
 *  that exists only to be measured.
 *
 *  ONE CLASS AUTHORITY PER ELEMENT. Every element here carries a JSX spread (the
 *  attribute bags below), and Solid applies spread props in KEY ORDER: a bag
 *  carrying `classList` is applied first, then a static `class` lands as
 *  `node.className = "…"` and erases what `classList` just added — and Solid
 *  remembers the class as applied, so nothing re-adds it until the value flips
 *  false → true. That is #2263's unlit-after-reload host tab. So the shell takes
 *  the two state facts as DATA (`active` / `down`) and derives each element's
 *  classes in a SINGLE `class` expression, and the bag types below forbid
 *  `class` / `classList` outright — a caller cannot reintroduce a second class
 *  authority through the spread. Pinned by `HostChipShell.test.tsx`. */

import type { HostKey } from "kolu-common/hostKey";
import type { Component, JSX } from "solid-js";
import { HostIdentityLabel } from "./HostIdentityLabel";

/** An attribute bag a caller hands to one of this shell's elements: every
 *  attribute EXCEPT the two that would make a second class authority beside the
 *  element's own `class` expression. */
type ClassFreeBag<T> = Omit<T, "class" | "classList">;

/** The tab's own state paint. `active` and `down` are INDEPENDENT: a down host
 *  that still owns the canvas keeps a desaturated belly
 *  (`.host-tab-active.host-tab-down` is its own rule in `index.css`), so both
 *  land; `idle` is strictly the resting case. */
function tabStateClass(active: boolean, down: boolean): string {
  return [
    active ? "host-tab-active" : "",
    !active && !down ? "host-tab-idle" : "",
    down ? "host-tab-down" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The label button's text tone — one of three, down winning over active. */
function labelToneClass(active: boolean, down: boolean): string {
  if (down) return "text-fg-3";
  return active ? "text-fg" : "text-fg-2 hover:text-fg";
}

export const HostChipShell: Component<{
  host: HostKey;
  decoration?: string;
  /** This host owns the canvas — the lit tab. The measuring twin passes
   *  nothing, which is the resting (idle) paint; neither state changes the
   *  chip's WIDTH, which is what makes the twin's measurement honest. */
  active?: boolean;
  /** The host's daemon chain is down — desaturated tab, faintest label. */
  down?: boolean;
  tab?: ClassFreeBag<JSX.HTMLAttributes<HTMLDivElement>> & {
    "data-asking"?: string;
    "data-unseen"?: string;
  };
  diagnostics?: ClassFreeBag<JSX.ButtonHTMLAttributes<HTMLButtonElement>> & {
    "data-testid"?: string;
  };
  select?: ClassFreeBag<JSX.ButtonHTMLAttributes<HTMLButtonElement>> & {
    "data-testid"?: string;
  };
  status?: JSX.Element;
  attention: JSX.Element;
  /** The host's agents mark, right after the host name (nothing when agents are
   *  off). The measuring twin renders it too, so a chip's width estimate counts
   *  it and the strip keeps to one row. */
  agents?: JSX.Element;
  /** Pinned to the tab's bottom edge with no layout of its own — the
   *  measuring twin leaves it out, since it adds no width to measure. */
  stripe?: JSX.Element;
}> = (props) => (
  <div
    {...props.tab}
    class={`host-tab relative flex h-8 items-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 has-[:focus-visible]:ring-inset ${tabStateClass(props.active ?? false, props.down ?? false)}`}
  >
    <button
      type="button"
      {...props.diagnostics}
      class="pointer-events-auto ml-2 flex h-7 w-4 shrink-0 items-center justify-center rounded-tl-[10px] transition-colors hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer"
    >
      {props.status}
    </button>
    <button
      type="button"
      {...props.select}
      class={`pointer-events-auto flex h-8 items-center gap-1.5 pl-1 pr-2.5 transition-colors focus-visible:outline-none cursor-pointer ${labelToneClass(props.active ?? false, props.down ?? false)}`}
    >
      <HostIdentityLabel
        host={props.host}
        labelClass={`truncate max-w-[5rem] lg:max-w-[10rem] font-medium${props.decoration ?? ""}`}
      />
    </button>
    {props.agents}
    {props.attention}
    {props.stripe}
  </div>
);
