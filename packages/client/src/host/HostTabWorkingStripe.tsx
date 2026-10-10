/** A running stripe along the host tab's bottom edge while any terminal on
 *  that host is active — the IDE title bar's "indeterminate progress" idiom.
 *
 *  The tab used to draw this fact as a spinner + count beside the name; that
 *  segment came and went as agents started and stopped, so the tab's width did
 *  too and every tab after it shifted. The stripe is absolutely positioned
 *  inside the tab (`.host-tab` is `relative`), so it adds no width and no
 *  height. Its paint is the ACTIVE colour (`--color-busy`, the same rust as the
 *  working spinner) and never the host hue or a connection colour: the dot
 *  beside the name already owns "connected", and one fact never recolours
 *  another's pixels. Sweep, track and the reduced-motion freeze live in
 *  `index.css` (`.host-tab-stripe`). */
import { type Component, Show } from "solid-js";

/** The words the stripe answers to — in the tab buttons' labels and titles,
 *  and as the host popover's `working` row. */
export function hostActiveLabel(count: number): string {
  return `${count} terminal${count === 1 ? "" : "s"} active`;
}

export const HostTabWorkingStripe: Component<{
  /** How many of this host's terminals are active (`hostMarks(key).active()`).
   *  Zero mounts nothing: the stripe is gone, not hidden. */
  active: number;
}> = (props) => (
  <Show when={props.active > 0}>
    <span
      class="host-tab-stripe pointer-events-none absolute inset-x-2.5 bottom-0 h-0.5 overflow-hidden rounded-full"
      data-testid="host-tab-working-stripe"
      aria-hidden="true"
    >
      <span class="host-tab-stripe-segment absolute inset-y-0 left-0 w-[30%] rounded-full" />
    </span>
  </Show>
);
