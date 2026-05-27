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

/** Iframe → parent: SDK booted and is ready to receive messages. */
export type ReadyMsg = {
  type: "kolu-artifact-sdk:ready";
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
