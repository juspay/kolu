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
  agoText,
  displayRecencyAt,
  type RecencyAt,
  type RecencyMode,
  recencyMode,
  type RowClocks,
  rowRecency,
  type RowRecency,
  waitText,
} from "./recency.ts";
export { type DockRowAttrs, dockRowAttrs } from "./rowAttrs.ts";
export {
  annotationLine,
  firstIntentLine,
  identityColor,
} from "./rowIdentity.ts";
export { type DockRowFacts, dockRowFacts } from "./rowFacts.ts";
export { type RowSubline, rowSubline, stateLabels } from "./rowSubline.ts";
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
