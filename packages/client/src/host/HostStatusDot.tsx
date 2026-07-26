/** The host tab's connection dot, with a thin ring around it when kolu holds
 *  forwards to that host.
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
 *  The marker reads on every pip tone rather than only the healthy one — a host
 *  can go unreachable while kolu still holds doors it opened before the link
 *  dropped. It took three cuts to settle its WEIGHT: a thick teal ring was
 *  jarring (heavy stroke plus offset, reading as a treatment of the dot), the
 *  corner badge that replaced it was illegible (a ⇄ glyph is mush at tab size),
 *  and this hairline is the shape of the first at the volume of neither. Every
 *  cut drew it in the FORWARD colour (teal), never the connection colour: green
 *  means health, teal means doors.
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
    {/* The pip runs a size larger than it used to (2.5 over 2). It grew for the
     *  corner badge that no longer exists, and it stays grown: a hairline ring
     *  around a bigger dot is easier to see than around a smaller one, without
     *  any of the weight that made the thick ring jarring. */}
    <span
      class={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${props.statusDot}`}
      data-testid="host-status-pip"
      aria-hidden="true"
    />
    <Show when={props.forwardCount > 0}>
      {/* Geometry only — no background, no glyph, no count. Anything PAINTED
       *  here would be recolouring the dot's area from a fact that is not the
       *  connection's, and anything DRAWN here is illegible at this size; both
       *  were tried. One pixel at 12px around a 10px pip: a hair's gap, which
       *  is what keeps it from reading as a thicker dot. */}
      <span
        class={`pointer-events-none absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ${FORWARD_RING}`}
        // Announced by the enclosing BUTTON, not here: this element is
        // `pointer-events-none`, so a `title` on it can never be hovered, and a
        // second accessible name for one fact is a second thing to keep in
        // step. `HostSelectorStrip` appends `forwardRingLabel` to the button's
        // own label, which is the copy a user actually gets.
        aria-hidden="true"
        data-testid="host-forward-ring"
        data-count={props.forwardCount}
      />
    </Show>
  </span>
);
