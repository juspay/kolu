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

// Only the two gutter tokens are re-exported: they are the ones kolu spends
// OUTSIDE this package (the dock's hidden-footer and its section header). The
// grid template, the gap, the branch column, the stripe, the subgrid restore,
// the surface table and the two container CLASS NAMES stay module-internal.
//
// They were exported, and the class names were documented as an escape hatch
// "for a surface that genuinely wants its own container element". That was the
// override knob this repo's own philosophy calls a defect, and it contradicted
// the sentence one file over: `DockSection`'s header says a receptacle may not
// leave a load-bearing step in the consumer's hands. It cannot say that and
// also ship the step. The containers are the answer; there is no second door.
export {
  DOCK_CARDS_GUTTER_CLASS,
  DOCK_CARDS_GUTTER_NEG_CLASS,
  type DockRowSurface,
  type NeedsYouDensity,
} from "./geometry.ts";
export {
  bindStatePip,
  type DockPaintBucket,
  type DockRowBucket,
  dockOverlayBucket,
  hasAgentOf,
  FALLBACK_PIP_GLYPH,
  FALLBACK_PIP_VARIANT,
  FALLBACK_ORDER_BUCKET,
  paintDockRow,
  pipGlyphFor,
  pipMotionKind,
  pipShellLive,
  pipVariant,
  type StatePipBind,
  type UnparkedPaintBucket,
} from "./pipBind.ts";
export { prTooltip } from "./prTooltip.ts";
export {
  displayRecencyAt,
  type RecencyAt,
  type RecencyMode,
  recencyMode,
  recencyText,
  type RowClocks,
  rowRecency,
  type RowRecency,
} from "./recency.ts";
export { type DockRowAttrs, dockRowAttrs } from "./rowAttrs.ts";
export {
  annotationLine,
  firstIntentLine,
  identityColor,
} from "./rowIdentity.ts";
export { type DockRowFacts, dockRowFacts } from "./rowFacts.ts";
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
  type NarrowedRowVocab,
  narrowRowVocab,
  type RowVocabField,
  RECENCY_MODES,
  ROW_AGENT_STATES,
  type RowAgentState,
  toWireRowVocab,
  type WireRowVocab,
} from "./narrow.ts";
