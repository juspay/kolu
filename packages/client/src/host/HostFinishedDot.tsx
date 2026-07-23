/** The quiet "N finished, unseen" amber dot — warm attention family (same hue
 *  as StatePip's unread corner badge), NOT the violet needs-you pill. For
 *  finished-but-unlooked-at work on a host you are NOT viewing. Sibling of
 *  `HostAwaitingPill` (violet = blocked on you; amber = something finished you
 *  have not opened).
 *
 *  Shown only when there's unseen work AND you're NOT viewing this host — pass the
 *  chip's own `active` flag and the suppression lives here, one place, instead of an
 *  `active ? 0 : count` ternary re-spelled at every call site. `sizeClass` is the
 *  ONLY per-surface pixel (the desktop dot is tighter than the roomier mobile one);
 *  the amber fill / shape / copy live here, so a size tweak can't re-fork them. */

import { FINISHED_DOT_CLASS } from "@kolu/solid-statepip/pipVariant";
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
      class={`shrink-0 ${FINISHED_DOT_CLASS} ${props.sizeClass}`}
      title={`${props.count} finished, unseen, on ${props.hostLabel}`}
      aria-label={`${props.count} finished terminals you haven't seen on ${props.hostLabel}`}
    />
  </Show>
);
