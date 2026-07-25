/** The host tab's connection dot, with a ring around it when kolu holds forwards
 *  to that host.
 *
 *  Two facts, one glyph, and deliberately not one paint: the DOT's colour is the
 *  connection-health fact and nothing else (`.claude/rules/solidjs.md` — never
 *  colour a status dot from anything but the fact), while the RING is a separate
 *  element around it carrying a fact of a completely different kind. Composing
 *  rather than merging is what keeps a forward from ever being able to influence
 *  what "connected" looks like.
 *
 *  It replaced a `⇄ n` chip beside the tab. The chip was chrome for something the
 *  dot could carry: the dot is already the click target that opens the dropdown
 *  where the forward rows live, so the count belongs in the label and the
 *  dropdown, not in a second visual competing with the attention pills.
 *
 *  The ring reads on every pip tone rather than only the healthy one — a host can
 *  go unreachable while kolu still holds doors it opened before the link dropped.
 *  It is drawn in the FORWARD colour (teal), never the connection colour: green
 *  means health, teal means doors, and a green ring reads as a second, quieter
 *  way of saying "connected" rather than as a fact of its own.
 */

import { type Component, Show } from "solid-js";
import { FORWARD_RING } from "../forwards/forwardTone";

/** The words the ring answers to — the count moved here from the visual. */
export function forwardRingLabel(count: number): string {
  return `${count} forwarded port${count === 1 ? "" : "s"} — click to manage`;
}

export const HostStatusDot: Component<{
  /** The pip's colour class, straight from the connection-health fact. */
  statusDot: string;
  /** How many forwards kolu holds to this host. Zero draws no ring. */
  forwardCount: number;
}> = (props) => (
  <span class="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
    <Show when={props.forwardCount > 0}>
      {/* Geometry only — no background, no text. A ring that painted anything
       *  would be recolouring the dot's area from a fact that is not the
       *  connection's, which is the one thing this arrangement forbids. */}
      <span
        class={`pointer-events-none absolute inset-0 rounded-full ${FORWARD_RING}`}
        role="img"
        data-testid="host-forward-ring"
        data-count={props.forwardCount}
        title={forwardRingLabel(props.forwardCount)}
        aria-label={forwardRingLabel(props.forwardCount)}
      />
    </Show>
    <span
      class={`inline-block h-2 w-2 rounded-full shrink-0 ${props.statusDot}`}
      data-testid="host-status-pip"
      aria-hidden="true"
    />
  </span>
);
