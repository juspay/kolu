/** The amber "N awaiting your input" pill — the host's awaiting count rendered
 *  from the shared `ATTENTION_PILL_CLASS` token (the Dock badge's own styling
 *  source), shown only when the count is > 0. One owner so every host surface —
 *  the desktop chip, the narrow host-switcher row, and the mobile chip — renders
 *  the SAME pill from the SAME token. (`HostSwitcherRow` previously hand-rolled
 *  the amber pill inline, drifting from the token even as it looked identical.)
 *
 *  `sizeClass` is the pill's ONLY per-surface pixel — the min-width / height /
 *  padding a given site wants (the desktop chip is tighter than the roomier
 *  mobile touch pill). `shrink-0` and the amber fill / numerals come from here,
 *  so a size tweak can't accidentally re-fork the colour. */

import { type Component, Show } from "solid-js";
import { ATTENTION_PILL_CLASS } from "@kolu/solid-statepip/pipVariant";

export const HostAwaitingPill: Component<{
  count: number;
  sizeClass: string;
}> = (props) => (
  <Show when={props.count > 0}>
    <span
      class={`${ATTENTION_PILL_CLASS} shrink-0 ${props.sizeClass}`}
      title={`${props.count} awaiting your input`}
    >
      {props.count}
    </span>
  </Show>
);
