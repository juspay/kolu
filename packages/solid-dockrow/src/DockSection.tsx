/** The CONTAINERS a dock row lives in — the repo card and the pinned needs-you
 *  strip — shipped as components rather than described as a class name.
 *
 *  The row's most load-bearing paint is scoped to them. Every wash, the active
 *  highlight and the row dividers read
 *  `:is(.dock-cards-section, .dock-needs-you-strip) > [data-dock-row]`, and the
 *  row's `grid-cols-subgrid` inherits the tracks the container declares. Both
 *  were a consumer's job: two class names and a grid pairing to spell by hand,
 *  documented in a README table. A consumer that rendered `<DockRow>` inside its
 *  own `<div>` got a structurally correct, attribute-complete row with NO violet
 *  "blocked on you" wash at all — and nothing failed.
 *
 *  That is this stylesheet's own recorded failure ("a surface silently outside
 *  the wash rather than outside it by anyone's decision") reproduced one level
 *  up, at the package boundary, against the exact consumer this package exists
 *  for. A receptacle may not leave a load-bearing step in the consumer's hands,
 *  however small — "small" is precisely what gets dropped, and a dropped step
 *  fails silently by construction. So the container ships.
 *
 *  What stays the app's is what only it can answer: the header band's content
 *  (a name, a count, its own attention capsules and their jump handlers), the
 *  repo hue, and its e2e handles. */

import { type Component, type JSX, Show } from "solid-js";
import {
  DOCK_NEEDS_YOU_STRIP_CLASS,
  DOCK_ROW_DENSITY,
  DOCK_ROW_GAP,
  DOCK_ROW_GRID,
  DOCK_SECTION_CLASS,
  type DockRowDensity,
  type NeedsYouDensity,
} from "./geometry.ts";

/** One repo's card — the grid the rows subgrid into, the wash scope, and the
 *  `--repo-color` socket every repo-tinted surface inside it reads. */
export const DockSection: Component<{
  /** Matches the rows inside it — the card's inset is a density decision like
   *  every other, so a touch list does not inherit desktop chrome padding. */
  density: DockRowDensity;
  /** The repo hue every tinted surface in the card reads (`--repo-color`). */
  repoColor: string;
  /** The sticky header band — name, count, whatever the app puts there. It
   *  renders INSIDE the grid, so it spells its own `col-span-full`. */
  header?: JSX.Element;
  /** The repo this card is for — `data-repo`, an e2e/debug handle. */
  repo?: string;
  testId?: string;
  children: JSX.Element;
}> = (props) => (
  <section
    data-testid={props.testId}
    data-repo={props.repo}
    style={{ "--repo-color": props.repoColor }}
    class={`${DOCK_SECTION_CLASS} grid ${DOCK_ROW_GRID} ${DOCK_ROW_GAP} ${DOCK_ROW_DENSITY[props.density].sectionPad}`}
  >
    {props.header}
    {props.children}
  </section>
);

/** The pinned needs-you strip — the second wash scope, and the one deviation
 *  the stylesheet spells twice: every entry here is asking by construction, so
 *  the resting wash is suppressed while the hue, the active highlight and the
 *  hover deepening all still come from the shared rules.
 *
 *  Renders unconditionally: whether the strip EXISTS is the app's call (kolu
 *  renders it only when something is blocked — a state the dock enters, not
 *  furniture it carries), and a container that decided that for its consumer
 *  would be deciding a product question from inside a stylesheet. */
export const DockNeedsYouStrip: Component<{
  density: NeedsYouDensity;
  testId?: string;
  children: JSX.Element;
}> = (props) => (
  <section
    data-testid={props.testId}
    aria-label="Agents waiting on you"
    class={`${DOCK_NEEDS_YOU_STRIP_CLASS} shrink-0 flex flex-col gap-0.5 border-b border-edge/40 py-1`}
    classList={{ "px-1": props.density === "full" }}
  >
    <Show when={props.density === "full"}>
      <span class="px-1.5 font-mono text-[0.55rem] font-bold uppercase tracking-[0.12em] text-fg-3">
        Needs you
      </span>
    </Show>
    {props.children}
  </section>
);
