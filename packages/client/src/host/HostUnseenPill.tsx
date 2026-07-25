/** The amber "N finished, unseen" count pill — warm attention family (same hue
 *  as StatePip's unread corner badge), NOT the violet needs-you pill. For
 *  finished-but-unlooked-at work on a host you are NOT viewing. Sibling of
 *  `HostAwaitingPill` (violet = blocked on you; amber = something finished you
 *  have not opened).
 *
 *  Shown only when there's unseen work AND you're NOT viewing this host — pass the
 *  chip's own `active` flag and the suppression lives here, one place, instead of an
 *  `active ? 0 : count` ternary re-spelled at every call site. `sizeClass` is the
 *  ONLY per-surface pixel (the desktop pill is tighter than the roomier mobile one);
 *  the amber fill / shape / copy live here, so a size tweak can't re-fork them.
 *
 *  Carries the COUNT, not a bare dot: the host tab already renders an 8 px
 *  connection dot two elements to the left, so a second, smaller, half-alpha dot
 *  read as part of it (#1988). The number is also the thing you actually want —
 *  "two finished over there" is a different decision from "one". */

import { UNSEEN_COUNT_CLASS } from "@kolu/solid-statepip/pipVariant";
import { type Component, Show } from "solid-js";

export const HostUnseenPill: Component<{
  count: number;
  active: boolean;
  hostLabel: string;
  sizeClass: string;
}> = (props) => (
  <Show when={props.count > 0 && !props.active}>
    <span
      // `role="img"` so the digit is announced as the sentence in `aria-label`
      // ("2 finished terminals you haven't seen on zest") rather than as a bare
      // "2" floating beside the host name.
      role="img"
      class={`shrink-0 ${UNSEEN_COUNT_CLASS} ${props.sizeClass}`}
      title={`${props.count} finished, unseen, on ${props.hostLabel}`}
      aria-label={`${props.count} finished terminals you haven't seen on ${props.hostLabel}`}
    >
      {props.count}
    </span>
  </Show>
);
