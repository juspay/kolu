/** The host tab's connection dot, with a notch on its corner when kolu holds
 *  forwards to that host.
 *
 *  Two facts, one glyph, and deliberately not one paint: the DOT's colour is the
 *  connection-health fact and nothing else (`.claude/rules/solidjs.md` — never
 *  colour a status dot from anything but the fact), while the NOTCH is a separate
 *  element beside it carrying a fact of a completely different kind. Composing
 *  rather than merging is what keeps a forward from ever being able to influence
 *  what "connected" looks like.
 *
 *  It replaced a `⇄ n` chip beside the tab. The chip was chrome for something the
 *  dot could carry: the dot is already the click target that opens the dropdown
 *  where the forward rows live, so the count belongs in the label and the
 *  dropdown, not in a second visual competing with the attention pills.
 *
 *  The marker reads on every pip tone rather than only the healthy one — a host
 *  can go unreachable while kolu still holds doors it opened before the link
 *  dropped — so it is a bordered badge on the pip's corner rather than an outline
 *  around it. The first cut WAS an outline and proved jarring in the field:
 *  heavy-handed at that size, and it read as a treatment of the dot instead of a
 *  fact beside it. Either way it is drawn in the FORWARD colour (teal), never the
 *  connection colour: green means health, teal means doors.
 */

import { type Component, Show } from "solid-js";
import { FORWARD_NOTCH } from "../forwards/forwardTone";

/** The words the notch answers to — the count moved here from the visual. */
export function forwardNotchLabel(count: number): string {
  return `${count} forwarded port${count === 1 ? "" : "s"} — click to manage`;
}

export const HostStatusDot: Component<{
  /** The pip's colour class, straight from the connection-health fact. */
  statusDot: string;
  /** How many forwards kolu holds to this host. Zero draws no notch. */
  forwardCount: number;
}> = (props) => (
  <span class="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
    {/* The pip runs a size larger than it used to (2.5 over 2): the notch sits
     *  on its corner, and at the old diameter the badge covered enough of the
     *  dot to blur the health colour it must never touch. */}
    <span
      class={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${props.statusDot}`}
      data-testid="host-status-pip"
      aria-hidden="true"
    />
    <Show when={props.forwardCount > 0}>
      {/* A badge, not an outline. It overlaps the pip's bottom-right corner and
       *  carries the forward glyph; the COUNT rides the label, because a number
       *  at this size is unreadable and would compete with the attention pills
       *  for the same job. */}
      <span
        class={`pointer-events-none absolute bottom-0 right-0 flex h-3 w-3 items-center justify-center rounded-full text-[7px] font-bold leading-none ${FORWARD_NOTCH}`}
        role="img"
        data-testid="host-forward-notch"
        data-count={props.forwardCount}
        title={forwardNotchLabel(props.forwardCount)}
        aria-label={forwardNotchLabel(props.forwardCount)}
      >
        ⇄
      </span>
    </Show>
  </span>
);
