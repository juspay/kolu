export {
  applyHighlights,
  type HighlightInputComment,
} from "../core/applyHighlights";
export { extractOffsets } from "../core/extractOffsets";
export { extractQuote, rootTextContent } from "../core/extractQuote";
export {
  findQuote,
  type QuoteMatch,
  rangeFromOffsets,
} from "../core/findQuote";
export {
  COMMENT_HIGHLIGHT_NAME_PREFIX,
  COMMENT_HIGHLIGHT_STYLE_THEMED,
} from "../core/theme";
export type {
  IframeToParent,
  Locator,
  ParentToIframe,
  QuoteRoot,
  SelectionRect,
  SelectMsg,
} from "../types";
export {
  type BindOptions,
  bindArtifactSdk,
  observeIframeDeepLink,
  observeIframeHistory,
  observeIframeNavigation,
  observeIframeOpenExternal,
  pushHighlightsTo,
} from "./bridge";
