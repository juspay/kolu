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
 *  so a size tweak can't accidentally re-fork the colour.
 *
 *  `onActivate` makes the pill a real affordance rather than a passive count:
 *  when supplied, the pill renders as a `<button>` that jumps to the host's
 *  awaiting terminal (`HostChip` wires it to `useFocusAwaiting`). A surface where
 *  the whole row already switches host on click (the switcher rows) omits it, and
 *  the pill stays a plain `<span>` — so it can never nest a button inside that
 *  row's own button. */

import { type Component, Show } from "solid-js";
import { ATTENTION_PILL_CLASS } from "@kolu/solid-statepip/pipVariant";

export const HostAwaitingPill: Component<{
  count: number;
  sizeClass: string;
  onActivate?: () => void;
  hostLabel?: string;
}> = (props) => (
  <Show when={props.count > 0}>
    <Show
      when={props.onActivate}
      fallback={
        <span
          class={`${ATTENTION_PILL_CLASS} shrink-0 ${props.sizeClass}`}
          title={`${props.count} awaiting your input`}
        >
          {props.count}
        </span>
      }
    >
      {(onActivate) => (
        <button
          type="button"
          data-testid="host-awaiting-jump"
          class={`${ATTENTION_PILL_CLASS} shrink-0 pointer-events-auto cursor-pointer transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 ${props.sizeClass}`}
          title={`Jump to the terminal awaiting your input${props.hostLabel ? ` on ${props.hostLabel}` : ""}${props.count > 1 ? ` (${props.count} — click to cycle)` : ""}`}
          aria-label={`Jump to terminal awaiting your input${props.hostLabel ? ` on ${props.hostLabel}` : ""} (${props.count})`}
          onClick={(e) => {
            // Sibling of the host-select tab button, but guard anyway: a jump is
            // its own action, not a host switch, so the click must not also
            // bubble to any ancestor row handler that would re-select the host.
            e.stopPropagation();
            onActivate()();
          }}
        >
          {props.count}
        </button>
      )}
    </Show>
  </Show>
);
