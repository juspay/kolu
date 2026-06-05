/** Parent-side bridge to the in-iframe artifact-sdk. Validates incoming
 *  messages by `event.source === iframe.contentWindow` (origin is the
 *  literal string `"null"` under opaque-origin sandbox, so origin-based
 *  validation is meaningless — identity is the check).
 *
 *  The bridge owns the parent↔iframe protocol surface: path delivery on
 *  ready/load, `SelectMsg` routing inward. It does NOT own reactive
 *  highlight state — the caller pushes via `pushHighlightsTo` (reactive
 *  data changes) and via `onDocumentReady` (in-iframe document boots),
 *  so "what comments exist" is never duplicated across modules.
 *
 *  Usage:
 *
 *    const dispose = bindArtifactSdk(iframeEl, {
 *      currentPath: () => "out/report.html",
 *      onSelect: (msg) => openComposer(msg),
 *      onDocumentReady: () => pushHighlightsTo(iframeEl, commentsForFile()),
 *    });
 *    onCleanup(dispose);
 */

import { match, P } from "ts-pattern";
import type {
  IframeToParent,
  Locator,
  ParentToIframe,
  SelectMsg,
} from "../types";

export interface BindOptions {
  currentPath: () => string | null;
  onSelect: (msg: SelectMsg) => void;
  /** Fired whenever the in-iframe SDK boots: initial `ready` message OR
   *  the iframe's `load` event after in-iframe navigation. The caller
   *  uses this to re-push highlights for the fresh document, since the
   *  reactive `pushHighlightsTo` effect only re-fires on data change. */
  onDocumentReady?: () => void;
}

export function bindArtifactSdk(
  iframe: HTMLIFrameElement,
  opts: BindOptions,
): () => void {
  const sendToIframe = (msg: ParentToIframe): void => {
    iframe.contentWindow?.postMessage(msg, "*");
  };

  const pushPath = (): void => {
    const path = opts.currentPath();
    if (path !== null) sendToIframe({ type: "kolu-artifact-sdk:path", path });
  };

  const onMessage = (event: MessageEvent<IframeToParent>): void => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    // The `event.source` identity check above already filters out
    // messages from other iframes, but `otherwise(() => undefined)`
    // is still the right shape: postMessage is a network-grade
    // boundary, and a newer in-iframe SDK could ship message types
    // this parent doesn't recognize. Silently dropping unknowns is
    // better than `NonExhaustiveError` crashing the bridge.
    match(msg)
      .with({ type: "kolu-artifact-sdk:ready" }, () => {
        pushPath();
        opts.onDocumentReady?.();
      })
      .with({ type: "kolu-artifact-sdk:select" }, (m) => {
        opts.onSelect(m);
      })
      .otherwise(() => undefined);
  };

  window.addEventListener("message", onMessage);
  // The iframe's `load` event fires every navigation inside it; re-handshake
  // so in-iframe link clicks (which don't change `src`) still produce a
  // working SDK on the new document.
  const onLoad = (): void => {
    pushPath();
    opts.onDocumentReady?.();
  };
  iframe.addEventListener("load", onLoad);

  return () => {
    window.removeEventListener("message", onMessage);
    iframe.removeEventListener("load", onLoad);
  };
}

/** Observe in-iframe navigation. The in-iframe SDK reports its document's own
 *  `location.pathname` on every boot via the `ready` message — the initial
 *  load AND every load after a same-frame link click. The parent can't read
 *  `contentWindow.location` under the opaque-origin sandbox, so this report is
 *  the only way to learn where an in-iframe link took the user. Fires
 *  `onNavigate(pathname)` on each report; the caller maps the pathname to its
 *  own notion of identity (e.g. a repo-relative file path) and follows it.
 *
 *  A focused listener rather than another `bindArtifactSdk` option: navigation
 *  following and comments are independent concerns with independent owners, so
 *  each binds its own slice of the protocol. The `event.source` identity check
 *  is the same network-grade boundary `bindArtifactSdk` applies. Returns a
 *  disposer. */
export function observeIframeNavigation(
  iframe: HTMLIFrameElement,
  onNavigate: (pathname: string) => void,
): () => void {
  const onMessage = (event: MessageEvent<IframeToParent>): void => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    // Match the payload shape, not just the `type`: previewed HTML runs
    // scripts under the same opaque origin and can post a `ready` message
    // with a missing or non-string `pathname`. `P.string` keeps that off
    // `onNavigate` (and out of the host's pathname inversion —
    // `@kolu/solid-browser`'s `pathFromPreviewPathname` — which calls string
    // methods on it) instead of throwing from this handler.
    match(msg)
      .with({ type: "kolu-artifact-sdk:ready", pathname: P.string }, (m) => {
        onNavigate(m.pathname);
      })
      .otherwise(() => undefined);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

/** Imperative push — call when the comments set or current path changes
 *  after the initial handshake. The bridge re-broadcasts on every call. */
export function pushHighlightsTo(
  iframe: HTMLIFrameElement,
  comments: Array<{ id: string; locator: Locator }>,
): void {
  iframe.contentWindow?.postMessage(
    { type: "kolu-artifact-sdk:render-highlights", comments },
    "*",
  );
}
