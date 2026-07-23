/** The violet "N awaiting your input" pill — host roll-up of agents blocked
 *  on you (`awaiting_user`). Uses `NEEDS_YOU_PILL_CLASS` (alert violet), the
 *  SAME family as the dock/title StatePip when it needs you — not amber
 *  (amber is unread / unseen-finished). One owner so desktop chip, narrow
 *  switcher row, and mobile chip cannot drift.
 *
 *  `sizeClass` is the pill's ONLY per-surface pixel (min-width / height /
 *  padding). Colour and shape come from the shared token. */

import { type Component, Show } from "solid-js";
import { NEEDS_YOU_PILL_CLASS } from "@kolu/solid-statepip/pipVariant";

export const HostAwaitingPill: Component<{
  count: number;
  sizeClass: string;
}> = (props) => (
  <Show when={props.count > 0}>
    <span
      class={`${NEEDS_YOU_PILL_CLASS} shrink-0 ${props.sizeClass}`}
      title={`${props.count} awaiting your input`}
    >
      {props.count}
    </span>
  </Show>
);
