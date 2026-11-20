export const DOCK_ROW_GRID = "grid-cols-[20px_minmax(0,1fr)_auto]";

export const DOCK_ROW_GAP = "gap-x-[0.7rem]";

export const DOCK_ROW_BRANCH_COL = "col-start-2";

export const DOCK_CARDS_SUBGRID_LEFT_RESTORE = "-ml-3 pl-3";

export const DOCK_CARDS_GUTTER_CLASS = "pr-3";
export const DOCK_CARDS_GUTTER_NEG_CLASS = "-mr-3";

export const DOCK_ROW_FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40";

export type DockRowSurface = "desktop" | "touch";

export const DOCK_ROW_SURFACE: Record<
  DockRowSurface,
  {
    rowPad: string;
    rowGutter: string;
    rowPress: string;
    rowFocus: string;
    sectionPad: string;
    headerPad: string;
    textLabel: string;
    textRecency: string;
    textSubline: string;
  }
> = {
  desktop: {
    rowPad: "py-2",
    rowGutter: `${DOCK_CARDS_GUTTER_NEG_CLASS} ${DOCK_CARDS_GUTTER_CLASS}`,
    rowPress: "hover:bg-surface-2/40",
    rowFocus: DOCK_ROW_FOCUS_RING,
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
    sectionPad: "pl-3 pr-3",
    headerPad: "flex items-center gap-2 -ml-3 -mr-3 pl-2.5 pr-3 py-2.5",
    textLabel: "text-[0.9rem]",
    textRecency: "text-[0.65rem]",
    textSubline: "text-[0.7rem]",
  },
};

export const DOCK_ROW_STRIPE_CLASS =
  "border-l-[length:var(--dock-edge-stripe-w)] border-l-transparent";

export const DOCK_SECTION_CLASS = "dock-cards-section";
export const DOCK_NEEDS_YOU_STRIP_CLASS = "dock-needs-you-strip";

export type NeedsYouDensity = "icon" | "full";
