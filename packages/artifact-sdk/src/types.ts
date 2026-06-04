/** Wire types for the artifact-sdk — the single source of truth for both
 *  the in-iframe SDK and the parent-side client/server modules. */

/** W3C TextQuoteSelector — surface-agnostic. `quote` is the selected text
 *  itself; `prefix`/`suffix` disambiguate when the quote occurs more than
 *  once in the host content. The re-find algorithm needs nothing else. */
export type Locator = {
  quote: string;
  prefix: string;
  suffix: string;
};

/** A root within which a quote is extracted and re-found. Three shapes,
 *  one contract: each exposes `textContent` and an owning document — itself
 *  when it IS a `Document`, else its `ownerDocument` — from which a
 *  `TreeWalker` is created (`Element`/`ShadowRoot` have no `createTreeWalker`
 *  of their own, so the core always builds the walker off the owner doc):
 *    - `Document`    — the in-iframe SDK, anchoring against the iframe's doc
 *    - `ShadowRoot`  — Pierre's `CodeView` (source / diff) lives in one
 *    - `Element`     — a light-DOM host subtree (the rendered Markdown
 *                      preview), so the haystack is the preview, not the
 *                      whole app page.
 *  Scoping to the narrowest of these is what keeps a comment's prefix/suffix
 *  context (and the highlight re-find) bounded to the view it was made in. */
export type QuoteRoot = Document | ShadowRoot | Element;

/** Pixel rect for placing a composer popover next to the captured selection.
 *  Coordinates are in the SDK's local viewport — the parent translates
 *  through the iframe's bounding rect before placing the composer. */
export type SelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Iframe → parent: user clicked the in-iframe pill after selecting text. */
export type SelectMsg = {
  type: "kolu-artifact-sdk:select";
  path: string;
  locator: Locator;
  rect: SelectionRect;
};

/** Iframe → parent: SDK booted and is ready to receive messages. Carries the
 *  document's own `location.pathname` — read from inside the frame because the
 *  opaque-origin sandbox blocks the parent from reading `contentWindow.location`.
 *  Reposted on every document boot, so the parent learns where a same-frame
 *  link click navigated (the host maps it back to a repo-relative path). */
export type ReadyMsg = {
  type: "kolu-artifact-sdk:ready";
  pathname: string;
};

/** Parent → iframe: tell the SDK which repo-relative path this artifact is. */
export type PathMsg = {
  type: "kolu-artifact-sdk:path";
  path: string;
};

/** Parent → iframe: refresh the set of highlights to render for current file. */
export type RenderHighlightsMsg = {
  type: "kolu-artifact-sdk:render-highlights";
  comments: Array<{ id: string; locator: Locator }>;
};

export type IframeToParent = SelectMsg | ReadyMsg;
export type ParentToIframe = PathMsg | RenderHighlightsMsg;
