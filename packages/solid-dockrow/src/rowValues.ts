/** The row's PURE half — every fold a consumer needs to compute what the row
 *  shows, with no JSX in the import graph.
 *
 *  Its own subpath (`@kolu/solid-dockrow/rowValues`), the same value/JSX split
 *  `@kolu/solid-statepip/pipVariant` makes and for the same reason: the pure
 *  consumers — the dock's ranking pass, the tile title's pip binder, and their
 *  unit tests — reach the folds WITHOUT pulling in the barrel's components,
 *  which a node-environment Vitest can't transform out of a workspace
 *  dependency. The rendering call sites import the components from the barrel;
 *  the two entry points are a deliberate split, not redundancy. */

export {
  DOCK_CARDS_GUTTER_CLASS,
  DOCK_CARDS_GUTTER_NEG_CLASS,
  DOCK_CARDS_SUBGRID_LEFT_RESTORE,
  DOCK_ROW_BRANCH_COL,
  DOCK_ROW_DENSITY,
  DOCK_ROW_GAP,
  DOCK_ROW_GRID,
  DOCK_ROW_STRIPE_CLASS,
  type DockRowDensity,
} from "./geometry.ts";
export {
  bindStatePip,
  type DockPaintBucket,
  type DockRowBucket,
  dockOverlayBucket,
  paintDockRow,
  pipGlyphFor,
  pipMotionKind,
  pipVariant,
  type StatePipBind,
  type UnparkedPaintBucket,
} from "./pipBind.ts";
export { prTooltip } from "./prTooltip.ts";
export {
  displayRecencyAt,
  type RecencyMode,
  recencyMode,
} from "./recency.ts";
export { type DockRowAttrs, dockRowAttrs } from "./rowAttrs.ts";
export {
  annotationLine,
  firstIntentLine,
  identityColor,
} from "./rowIdentity.ts";
export { type RowSubline, rowSubline, stateLabels } from "./rowSubline.ts";
// The PIP trio's narrowing rides through this door too — the guards live with
// the vocabulary they fence (`@kolu/solid-statepip`, beside the records that
// enumerate it), because location is structure; they are re-exported HERE
// because a consumer filling one prop bag should not have to know the bag's
// vocabulary has two homes. Same reason `rowValues` gathers the folds at all.
export {
  isPipGlyphId,
  isPipMotionKind,
  isPipVariant,
  PIP_GLYPH_IDS,
  PIP_MOTION_KINDS,
  PIP_VARIANTS,
} from "@kolu/solid-statepip/pipVariant";
export {
  DOCK_ROW_BUCKETS,
  isDockRowBucket,
  isRecencyMode,
  isRowAgentState,
  narrowAgentState,
  type NarrowedAgentState,
  RECENCY_MODES,
  ROW_AGENT_STATES,
  type RowAgentState,
} from "./narrow.ts";
