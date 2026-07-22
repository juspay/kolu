/** The quiet "N finished, unseen" amber dot — the softer tier of the same
 *  "needs you" amber the `HostAwaitingPill` speaks, for finished-but-unlooked-at
 *  work on a host you are NOT viewing. One owner so the desktop chip, the narrow
 *  host-switcher row, and the mobile chip render the SAME dot (colour + copy +
 *  a11y) from one place — the sibling of `HostAwaitingPill`, whose own doc records
 *  the amber mark drifting once when it was hand-rolled per site.
 *
 *  Suppressed on the ACTIVE host (you've seen it): pass `count={0}` there. Shown
 *  only when `count > 0`, mirroring the pill. `sizeClass` is the ONLY per-surface
 *  pixel (the desktop dot is tighter than the roomier mobile one); the amber fill /
 *  shape / copy live here, so a size tweak can't re-fork the colour or the label. */

import { type Component, Show } from "solid-js";

export const HostFinishedDot: Component<{
  count: number;
  hostLabel: string;
  sizeClass: string;
}> = (props) => (
  <Show when={props.count > 0}>
    <span
      role="img"
      class={`shrink-0 rounded-full bg-amber-500/50 ${props.sizeClass}`}
      title={`${props.count} finished, unseen, on ${props.hostLabel}`}
      aria-label={`${props.count} finished terminals you haven't seen on ${props.hostLabel}`}
    />
  </Show>
);
