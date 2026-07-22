/** The quiet "N finished, unseen" amber dot — the softer tier of the same
 *  "needs you" amber the `HostAwaitingPill` speaks, for finished-but-unlooked-at
 *  work on a host you are NOT viewing. One owner so the desktop chip, the narrow
 *  host-switcher row, and the mobile chip render the SAME dot (colour + copy +
 *  a11y) from one place — the sibling of `HostAwaitingPill`, whose own doc records
 *  the amber mark drifting once when it was hand-rolled per site.
 *
 *  Shown only when there's unseen work AND you're NOT viewing this host — pass the
 *  chip's own `active` flag and the suppression lives here, one place, instead of an
 *  `active ? 0 : count` ternary re-spelled at every call site. `sizeClass` is the
 *  ONLY per-surface pixel (the desktop dot is tighter than the roomier mobile one);
 *  the amber fill / shape / copy live here, so a size tweak can't re-fork them. */

import { type Component, Show } from "solid-js";

export const HostFinishedDot: Component<{
  count: number;
  active: boolean;
  hostLabel: string;
  sizeClass: string;
}> = (props) => (
  <Show when={props.count > 0 && !props.active}>
    <span
      role="img"
      class={`shrink-0 rounded-full bg-amber-500/50 ${props.sizeClass}`}
      title={`${props.count} finished, unseen, on ${props.hostLabel}`}
      aria-label={`${props.count} finished terminals you haven't seen on ${props.hostLabel}`}
    />
  </Show>
);
