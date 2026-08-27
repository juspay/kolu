/** The dock row's GEOMETRY vocabulary — the grid the section declares, the
 *  tracks a row spans inside it, and the per-density pixel table.
 *
 *  It moved out of kolu-client's `ui/chromeSpacing.ts` with the row itself:
 *  these classes are not chrome-wide spacing, they are the row's own layout
 *  contract, and a consumer that renders the row must declare the same grid on
 *  the section around it or the subgrid has nothing to align to. Location is
 *  structure — the constants live beside the component that spends them. */

/** Cards-mode section grid — the three tracks a row's `grid-cols-subgrid`
 *  inherits (`DOCK_ROW_GRID` below), with the line-2 flex row spanning cols
 *  2→end. Changing a track means changing `DOCK_ROW_GRID` and
 *  `DOCK_ROW_BRANCH_COL` together. 20 px matches `DOCK_ROW_PIP_BOX` (the
 *  identity-glyph column). */
export const DOCK_ROW_GRID = "grid-cols-[20px_minmax(0,1fr)_auto]";

/** Column gap between the row's three tracks. */
export const DOCK_ROW_GAP = "gap-x-[0.7rem]";

/** Where the branch/annotation column starts — line 2 anchors here so PR pips
 *  align across every section. */
export const DOCK_ROW_BRANCH_COL = "col-start-2";

/** A row bleeds into the section's left padding so its attention stripe sits
 *  at the card's inner edge, then restores the padding for its own content.
 *  The LEFT side is symmetric across desktop and touch, so it ships as one
 *  symbol; the right gutter is not (see `DOCK_CARDS_GUTTER_CLASS`). */
export const DOCK_CARDS_SUBGRID_LEFT_RESTORE = "-ml-3 pl-3";

/** The cards-mode right gutter, and its negative-margin twin. Paired: a
 *  descendant that bleeds out with the negative margin pushes its own content
 *  back in with the padding. The touch list spells the same VALUE inline
 *  because it encodes a different volatility (touch density, not the desktop
 *  chrome-density vocabulary) — deliberately not this symbol. */
export const DOCK_CARDS_GUTTER_CLASS = "pr-3";
export const DOCK_CARDS_GUTTER_NEG_CLASS = "-mr-3";

/** The keyboard focus ring every row surface wears. One token: it was spelled
 *  out in three files, which is the "update both files when geometry changes"
 *  failure this package exists to end, in miniature. */
export const DOCK_ROW_FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40";

/** WHICH SURFACE a row is on — kolu's on-canvas dock, or its touch drawer /
 *  compact rail. The one axis `Dock.tsx` and `DockList.tsx` differ by.
 *
 *  Named for the surface, not for "density", and that is a correction rather
 *  than a preference: `SubTerminalRow` already called it `surface` before this
 *  package existed, and it was right. What varies across the two is NOT only
 *  how much room there is. It is also the INPUT — a mouse hovers and a finger
 *  presses; a desktop row wears a keyboard focus ring and a touch row has no
 *  keyboard to earn one from. Room and input are two facts, but they are not
 *  two axes here: both follow from which surface you are on, and there is no
 *  such thing in kolu as a touch-sized row driven by a mouse. One honest axis
 *  with two consequences beats one dishonest axis called "density" carrying a
 *  consequence its own name denies.
 *
 *  `Dock.tsx` and `DockList.tsx` used to be two hand-kept copies of one row,
 *  linked by a comment reading "Update both files when row geometry changes" —
 *  which is the shape a table exists to replace. */
export type DockRowSurface = "desktop" | "touch";

/** The per-surface pixel table.
 *
 *  Each field is prefixed with the component that SPENDS it, because the table
 *  does not vary uniformly and pretending otherwise is what makes a shared
 *  table lie. `row*` is `DockRow`'s alone: it is the only component whose focus
 *  ring and pointer feedback change with the surface. `DockSubRow` and
 *  `DockNeedsYouRow` carry the focus ring on BOTH surfaces — they are
 *  single-line and always keyboard-reachable, and that was true before the
 *  extraction too — so they read only their own padding and spell the rest
 *  themselves. `text*` is shared by every component that renders words.
 *
 *  Exhaustive `Record`, so a third surface stops this compiling until every
 *  field is decided for it. */
export const DOCK_ROW_SURFACE: Record<
  DockRowSurface,
  {
    /** `DockRow` vertical padding — touch clears the 44-48 px tap minimum. */
    rowPad: string;
    /** `DockRow` right gutter + its bleed.
     *
     *  The two cells expand to the same string TODAY, and they are still two
     *  cells: desktop's is the chrome-density vocabulary
     *  (`DOCK_CARDS_GUTTER_*`, which moves when chrome density moves), touch's
     *  is a touch-density choice that happens to have landed on the same
     *  value. Before this table those two decisions lived in two files and the
     *  coincidence was invisible; here it is one line apart and legible, which
     *  is the argument for the table rather than against it. */
    rowGutter: string;
    /** `DockRow` pointer feedback: a mouse hovers, a finger presses. */
    rowPress: string;
    /** `DockRow` keyboard focus ring — desktop only. */
    rowFocus: string;
    /** `DockSubRow` vertical padding. */
    subRowPad: string;
    /** `DockSection` left inset + right gutter. */
    sectionPad: string;
    /** `DockSection`'s sticky header BAND — its flex row, its inset, and the
     *  negative-margin bleed that lets the wash reach the card's edges.
     *
     *  In the table rather than a prop because it is package geometry, not app
     *  chrome: the bleed pair is the same one `DOCK_CARDS_GUTTER_*` documents
     *  and the section spends for itself. It was briefly a free-form
     *  `headerClass` prop, which meant a consumer omitting it got a header band
     *  with no flex row, no inset and no bleed — silently. That is the exact
     *  failure `DockSection` exists to close, reintroduced one prop down. What
     *  stays the app's is the header's CONTENT. */
    headerPad: string;
    /** Annotation-line size. */
    textLabel: string;
    /** Recency-cell size. */
    textRecency: string;
    /** Second-line subline size. */
    textSubline: string;
  }
> = {
  desktop: {
    rowPad: "py-2",
    rowGutter: `${DOCK_CARDS_GUTTER_NEG_CLASS} ${DOCK_CARDS_GUTTER_CLASS}`,
    rowPress: "hover:bg-surface-2/40",
    rowFocus: DOCK_ROW_FOCUS_RING,
    subRowPad: "py-1",
    sectionPad: `pl-3 ${DOCK_CARDS_GUTTER_CLASS}`,
    headerPad: `flex items-center gap-2 -ml-3 ${DOCK_CARDS_GUTTER_NEG_CLASS} pl-2.5 pr-3 py-2`,
    textLabel: "text-[0.84rem]",
    textRecency: "text-[0.6rem]",
    textSubline: "text-[0.68rem]",
  },
  touch: {
    rowPad: "py-3",
    rowGutter: "-mr-3 pr-3",
    rowPress: "active:bg-surface-2",
    rowFocus: "",
    subRowPad: "py-2",
    sectionPad: "pl-3 pr-3",
    headerPad: "flex items-center gap-2 -ml-3 -mr-3 pl-2.5 pr-3 py-2.5",
    textLabel: "text-[0.9rem]",
    textRecency: "text-[0.65rem]",
    textSubline: "text-[0.7rem]",
  },
};

/** The shared left stripe every row reserves — 3-5 px of transparent border the
 *  active highlight and the attention wash both fill, so neither costs the row
 *  any geometry and the dock never reflows when either turns on. */
export const DOCK_ROW_STRIPE_CLASS =
  "border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent";

/** The repo CARD a row lives in, and the pinned NEEDS-YOU STRIP — the two
 *  classes `dockrow.css` scopes every wash, the active highlight and the row
 *  dividers to (`:is(.dock-cards-section, .dock-needs-you-strip) >
 *  [data-dock-row]`).
 *
 *  Exported as VALUES, not described in a README, because they are load-bearing
 *  and they fail SILENTLY: a consumer that renders a `<DockRow>` in a container
 *  of its own gets a structurally correct, attribute-complete row with no violet
 *  "blocked on you" wash at all, and nothing errors. That is this stylesheet's
 *  own recorded failure — "a surface silently outside the wash rather than
 *  outside it by anyone's decision" — reproduced one level up, at the package
 *  boundary. `<DockSection>` and `<DockNeedsYouStrip>` spend them so a consumer
 *  need not; these constants are for a surface that genuinely wants its own
 *  container element and still has to land inside the rules. */
export const DOCK_SECTION_CLASS = "dock-cards-section";
export const DOCK_NEEDS_YOU_STRIP_CLASS = "dock-needs-you-strip";

/** How much of a needs-you entry there is ROOM for. Named for the axis, not for
 *  the caller: a touch surface's persistent left rail takes `"full"`, because
 *  what a desktop dock's rail mode really means here is "44 px, icons only".
 *
 *  Beside the row densities rather than inside the component, because the STRIP
 *  and its ENTRIES both read it and neither owns the other. */
export type NeedsYouDensity = "icon" | "full";
