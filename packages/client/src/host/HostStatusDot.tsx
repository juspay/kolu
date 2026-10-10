/** The host tab's connection dot, with a thin ring around it when kolu holds
 *  forwards to that host, and a THROB while any terminal on that host is active.
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

/** The words the throb answers to. The tab used to draw this count as a
 *  spinner + number beside the name; that segment came and went as agents
 *  started and stopped, so the tab's width did too and every tab after it
 *  shifted. The fact now rides the dot as motion, and its words ride the
 *  buttons' labels (and the host popover's `working` row). */
export function hostActiveLabel(count: number): string {
  return `${count} terminal${count === 1 ? "" : "s"} active`;
}

/** Motion only — the class carries no colour token, so it can never say
 *  "connected" or "down", only "something is happening here". Keyframe and
 *  its ring-fitting peak live in `index.css` (`host-dot-throb`). */
export const HOST_DOT_THROB_CLASS = "host-dot-throb motion-reduce:animate-none";

export const HostStatusDot: Component<{
  /** The pip's colour class, straight from the connection-health fact. */
  statusDot: string;
  /** How many forwards kolu holds to this host. Zero draws no ring. */
  forwardCount: number;
  /** How many of this host's terminals are active (`hostMarks(key).active()`).
   *  Above zero the pip THROBS — scale and opacity only, so its colour stays
   *  the connection fact. */
  active: number;
}> = (props) => (
  <span class="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
    {/* The pip runs a size larger than it used to (2.5 over 2). It grew for the
     *  corner badge that no longer exists, and it stays grown: a hairline ring
     *  around a bigger dot is easier to see than around a smaller one, without
     *  any of the weight that made the thick ring jarring. */}
    <span
      // Motion as a SECOND channel over the same pixels (`HOST_DOT_THROB_CLASS`).
      // One `class` string, not `class` + `classList`: the colour is dynamic,
      // and Solid's `class` write would clobber a `classList` toggle.
      class={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${props.statusDot}${props.active > 0 ? ` ${HOST_DOT_THROB_CLASS}` : ""}`}
      data-testid="host-status-pip"
      data-throb={props.active > 0 ? "" : undefined}
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
