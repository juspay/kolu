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

/** How much room a row has. The ONE axis the desktop dock and the touch list
 *  differ by; every pixel that differs between them is a column of
 *  {@link DOCK_ROW_DENSITY} rather than a second component.
 *
 *  `Dock.tsx` and `DockList.tsx` used to be two hand-kept copies of one row,
 *  linked by a comment reading "Update both files when row geometry changes" —
 *  which is the shape a table exists to replace. */
export type DockRowDensity = "desktop" | "touch";

/** The per-density pixel table. Exhaustive `Record`, so a third density stops
 *  this compiling until every axis is decided for it. */
export const DOCK_ROW_DENSITY: Record<
  DockRowDensity,
  {
    /** Vertical padding — touch clears the 44-48 px tap minimum. */
    rowPad: string;
    /** Right gutter + its bleed. */
    gutter: string;
    /** Pointer feedback: desktop hovers, touch presses. */
    press: string;
    /** Keyboard focus ring — desktop only (the touch surfaces have no
     *  keyboard to focus from, and the ring is a desktop chrome idiom). */
    focus: string;
    /** Annotation-line size. */
    label: string;
    /** Recency-cell size. */
    recency: string;
    /** Second-line subline size. */
    subline: string;
    /** The split row's vertical padding (`DockSubRow`). */
    subRowPad: string;
  }
> = {
  desktop: {
    rowPad: "py-2",
    gutter: `${DOCK_CARDS_GUTTER_NEG_CLASS} ${DOCK_CARDS_GUTTER_CLASS}`,
    press: "hover:bg-surface-2/40",
    focus:
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40",
    label: "text-[0.84rem]",
    recency: "text-[0.6rem]",
    subline: "text-[0.68rem]",
    subRowPad: "py-1",
  },
  touch: {
    rowPad: "py-3",
    gutter: "-mr-3 pr-3",
    press: "active:bg-surface-2",
    focus: "",
    label: "text-[0.9rem]",
    recency: "text-[0.65rem]",
    subline: "text-[0.7rem]",
    subRowPad: "py-2",
  },
};

/** The shared left stripe every row reserves — 3-5 px of transparent border the
 *  active highlight and the attention wash both fill, so neither costs the row
 *  any geometry and the dock never reflows when either turns on. */
export const DOCK_ROW_STRIPE_CLASS =
  "border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent";
