/** Parent-side bridge to the in-iframe artifact-sdk. Validates incoming
 *  messages by `event.source === iframe.contentWindow` (origin is the
 *  literal string `"null"` under opaque-origin sandbox, so origin-based
 *  validation is meaningless — identity is the check).
 *
 *  Usage:
 *
 *    const dispose = bindArtifactSdk(iframeEl, {
 *      currentPath: () => "out/report.html",
 *      commentsForPath: () => store.commentsForPath("out/report.html"),
 *      onSelect: (msg) => openComposer(msg),
 *    });
 *    onCleanup(dispose);
 */

import type {
  IframeToParent,
  Locator,
  ParentToIframe,
  SelectMsg,
} from "../types";

export interface BindOptions {
  currentPath: () => string | null;
  commentsForPath: () => Array<{ id: string; locator: Locator }>;
  onSelect: (msg: SelectMsg) => void;
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

  const pushHighlights = (): void => {
    sendToIframe({
      type: "kolu-artifact-sdk:render-highlights",
      comments: opts.commentsForPath(),
    });
  };

  const onMessage = (event: MessageEvent<IframeToParent>): void => {
    if (event.source !== iframe.contentWindow) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "kolu-artifact-sdk:ready":
        pushPath();
        pushHighlights();
        break;
      case "kolu-artifact-sdk:select":
        opts.onSelect(msg);
        break;
    }
  };

  window.addEventListener("message", onMessage);
  // The iframe's `load` event fires every navigation inside it; re-handshake
  // so in-iframe link clicks (which don't change `src`) still produce a
  // working SDK on the new document.
  const onLoad = (): void => {
    pushPath();
    pushHighlights();
  };
  iframe.addEventListener("load", onLoad);

  return () => {
    window.removeEventListener("message", onMessage);
    iframe.removeEventListener("load", onLoad);
  };
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
