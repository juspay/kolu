/** Parent-side entrypoint for the artifact-sdk.
 *  - `extractQuote` / `findQuote` / `rangeFromOffsets` are re-exports of
 *    the SAME pure functions the in-iframe bundle uses — surfaces that
 *    capture or render comments outside the iframe (text browse, branch
 *    diff) import these so the W3C TextQuoteSelector behavior is
 *    bit-identical across runtimes.
 *  - `bindArtifactSdk` wires the parent ↔ iframe message protocol;
 *    `observeIframeNavigation` is the focused sibling that follows
 *    same-frame link navigation. */

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
export { COMMENT_HIGHLIGHT_STYLE_THEMED } from "../core/theme";
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
  observeIframeHistory,
  observeIframeNavigation,
  observeIframeOpenExternal,
  pushHighlightsTo,
} from "./bridge";
