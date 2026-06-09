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
 *  one contract: all expose `textContent`; ShadowRoot and Element
 *  additionally expose `ownerDocument` — the Document the TreeWalker is
 *  created from (`Element`/`ShadowRoot` have no `createTreeWalker` of their
 *  own, so the core always goes through the owner doc):
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

/** Iframe → parent: the user pressed a mouse back/forward (X1/X2) button
 *  inside the preview. The opaque-origin sandbox traps these events in the
 *  frame — they never bubble to the parent — so the SDK forwards the intent and
 *  the parent drives its own history (the Code-tab browser's back/forward). */
export type HistoryMsg = {
  type: "kolu-artifact-sdk:history";
  direction: "back" | "forward";
};

/** Iframe → parent: a request to open an absolute URL in a real browser tab,
 *  emitted by the SDK when it traps a click on an anchor that resolves to a
 *  different origin than the previewed document. The opaque-origin sandbox
 *  swallows such clicks — `allow-scripts` carries no `allow-popups` (so
 *  `target=_blank` is blocked) and no `allow-top-navigation` — and a plain click
 *  would replace the preview with the remote page in-pane. The SDK suppresses
 *  the default and forwards the absolute URL so the parent (top frame, not
 *  sandboxed) opens it.
 *
 *  Trust note: this is an UNAUTHENTICATED message. The previewed HTML runs
 *  arbitrary scripts under the same opaque origin, so any of them — not only the
 *  SDK's click trap — can post this with an attacker-chosen http(s) `url`. The
 *  parent must treat it as a request from untrusted content, not proof of a real
 *  user click. It is accepted anyway because the granted capability (open a
 *  `noopener,noreferrer` http(s) foreground tab) is strictly weaker than the
 *  `location =`/`fetch` egress a sandboxed script already has. The parent
 *  re-validates the scheme before `window.open` so `javascript:`/`data:` URLs
 *  (which would execute in kolu's trusted origin) can never reach it. */
export type OpenExternalMsg = {
  type: "kolu-artifact-sdk:open-external";
  url: string;
};

export type IframeToParent =
  | SelectMsg
  | ReadyMsg
  | HistoryMsg
  | OpenExternalMsg;
export type ParentToIframe = PathMsg | RenderHighlightsMsg;
