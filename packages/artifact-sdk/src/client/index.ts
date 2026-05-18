/** Parent-side entrypoint for the artifact-sdk.
 *  - `extractQuote` / `findQuote` / `rangeFromOffsets` are re-exports of
 *    the SAME pure functions the in-iframe bundle uses — surfaces that
 *    capture or render comments outside the iframe (text browse, branch
 *    diff) import these so the W3C TextQuoteSelector behavior is
 *    bit-identical across runtimes.
 *  - `bindArtifactSdk` wires the parent ↔ iframe message protocol. */

export { extractQuote } from "../core/extractQuote";
export {
  findQuote,
  rangeFromOffsets,
  type QuoteMatch,
} from "../core/findQuote";
export {
  applyHighlights,
  type HighlightInputComment,
} from "../core/applyHighlights";
export {
  COMMENT_HIGHLIGHT_BACKGROUND,
  COMMENT_HIGHLIGHT_UNDERLINE,
  COMMENT_HIGHLIGHT_STYLE,
  COMMENT_HIGHLIGHT_STYLE_THEMED,
} from "../core/theme";
export {
  bindArtifactSdk,
  pushHighlightsTo,
  type BindOptions,
} from "./bridge";
export type {
  Locator,
  SelectMsg,
  SelectionRect,
  IframeToParent,
  ParentToIframe,
} from "../types";
