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
  DOCK_ROW_SURFACE,
  DOCK_ROW_GAP,
  DOCK_ROW_GRID,
  DOCK_SECTION_CLASS,
  type DockRowSurface,
  type NeedsYouDensity,
} from "./geometry.ts";

/** One repo's card — the grid the rows subgrid into, the wash scope, and the
 *  `--repo-color` socket every repo-tinted surface inside it reads. */
export const DockSection: Component<{
  /** Matches the rows inside it — the card's inset is a density decision like
   *  every other, so a touch list does not inherit desktop chrome padding. */
  surface: DockRowSurface;
  /** The repo hue every tinted surface in the card reads (`--repo-color`). */
  repoColor: string;
  /** The CONTENT of the sticky header band — a name, a count, attention
   *  capsules, whatever the app puts there.
   *
   *  The band itself is ours: `dock-cards-section-header` is a wash-scoped class
   *  exactly like the section's own, and leaving it for the caller to remember
   *  was the same silent miss this component exists to close — a structurally
   *  correct section whose header simply does not pin, with nothing erroring.
   *  So pass the contents; the band, its class and its `col-span-full` are
   *  applied here. */
  header?: JSX.Element;
  headerTestId?: string;
  /** The repo this card is for — `data-repo`, an e2e/debug handle. */
  repo?: string;
  testId?: string;
  children: JSX.Element;
}> = (props) => (
  <section
    data-testid={props.testId}
    data-repo={props.repo}
    style={{ "--repo-color": props.repoColor }}
    class={`${DOCK_SECTION_CLASS} grid ${DOCK_ROW_GRID} ${DOCK_ROW_GAP} ${DOCK_ROW_SURFACE[props.surface].sectionPad}`}
  >
    <Show when={props.header}>
      <div
        data-testid={props.headerTestId}
        class={`dock-cards-section-header col-span-full ${DOCK_ROW_SURFACE[props.surface].headerPad}`}
      >
        {props.header}
      </div>
    </Show>
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

/** Event-listener dict a consumer's drag library (solid-dnd's `dragActivators`,
 *  slots any pointer-sensor) spreads onto an element: keys are the sensor's
 *  event names (`onpointerdown`, …). The package invents no library of its
 *  own, so the socket is as narrow as "a dict of functions". */
export type DockDragHandlers = Record<string, (event: Event) => void>;

/** A first-class div for the branch/intent cluster — the sortable's boundary (kolu's #2247
 *  drag-to-rearrange). An anonymous fragment has no node a sortable can register;
 *  this is the element the gesture lands on.
 *
 *  The slot ITSELF ships the minimum the rows around it demand, and no more:
 *  `grid grid-cols-subgrid col-span-full` — pass the section's tracks through
 *  to its rows (subgrid reads the direct parent only), spanning the full row
 *  and a handful of sockets so the consumer's drag wiring can attach
 *  without the package knowing its library: `ref`, `style`, and a generic
 *  `handlers` passthrough the caller spells itself. Paint stays the css's:
 *  the wash scope, dividers and `--attn` binds read `.dock-cluster` along
 *  the `>` edge — a direct child of the section *either way*. */
export const DockCluster: Component<{
  /** The cluster's branch/intent label — `data-label`, an e2e/debug handle. */
  label: string;
  /** Consumer's sortable ref — the package ships no drag lib of its own. */
  ref?: HTMLDivElement | ((el: HTMLDivElement) => void);
  /** Consumer's sortable transform — during a drag, the wrapper moves; rows never do. */
  style?: JSX.CSSProperties;
  /** Consumer's activator listeners, spread onto the element (e.g. pointerdown). */
  handlers?: DockDragHandlers;
  children: JSX.Element;
}> = (props) => (
  <div
    ref={props.ref}
    style={props.style}
    {...props.handlers}
    data-label={props.label}
    class="dock-cluster grid grid-cols-subgrid col-span-full"
  >
    {props.children}
  </div>
);

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
