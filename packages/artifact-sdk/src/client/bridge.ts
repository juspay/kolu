import { match, P } from "ts-pattern";
import {
  isCrossOriginHttpUrl,
  isDeepLinkHash,
  parseHttpUrl,
} from "../core/url";
import type {
  IframeToParent,
  Locator,
  ParentToIframe,
  SelectMsg,
} from "../types";

/** `event.origin` is the literal string `"null"` for the opaque-origin sandbox
 *  the preview iframe runs in, so sender identity is the only usable check. */
function isFromIframe(
  event: MessageEvent<unknown>,
  iframe: HTMLIFrameElement,
): boolean {
  return event.source === iframe.contentWindow;
}

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
    if (!isFromIframe(event, iframe)) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
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

function observeFromIframe<T>(
  iframe: HTMLIFrameElement,
  extract: (msg: IframeToParent) => T | null,
  handle: (t: T) => void,
): () => void {
  const onMessage = (event: MessageEvent<IframeToParent>): void => {
    if (!isFromIframe(event, iframe)) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;
    const extracted = extract(msg);
    if (extracted !== null) handle(extracted);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
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
 *  disposer.
 *
 *  Matches the payload shape, not just the `type`: previewed HTML runs scripts
 *  under the same opaque origin and can post a `ready` message with a missing
 *  or non-string `pathname`. `P.string` keeps that off `onNavigate` (and out
 *  of the host's pathname inversion — `@kolu/solid-browser`'s
 *  `pathFromPreviewPathname` — which calls string methods on it). */
export function observeIframeNavigation(
  iframe: HTMLIFrameElement,
  onNavigate: (pathname: string) => void,
): () => void {
  return observeFromIframe(
    iframe,
    (msg) =>
      match(msg)
        .with(
          { type: "kolu-artifact-sdk:ready", pathname: P.string },
          (m) => m.pathname,
        )
        .otherwise(() => null),
    onNavigate,
  );
}

/** Observe the mouse's back/forward (X1/X2) buttons pressed inside the preview.
 *  The opaque-origin sandbox traps these events in the frame, so the in-iframe
 *  SDK forwards them as `history` messages and this lets the parent drive its
 *  own history (the Code-tab browser's back/forward) — so the buttons behave
 *  the same over a preview as over the file tree. Mirrors
 *  `observeIframeNavigation`: a focused listener with the same `event.source`
 *  identity boundary; the `P.union` payload guard keeps a hostile in-frame
 *  script from posting an out-of-range `direction`. Returns a disposer. */
export function observeIframeHistory(
  iframe: HTMLIFrameElement,
  onHistory: (direction: "back" | "forward") => void,
): () => void {
  return observeFromIframe(
    iframe,
    (msg) =>
      match(msg)
        .with(
          {
            type: "kolu-artifact-sdk:history",
            direction: P.union("back", "forward"),
          },
          (m) => m.direction,
        )
        .otherwise(() => null),
    onHistory,
  );
}

/** Observe a request from the previewed document to open an external URL. The
 *  opaque-origin sandbox swallows external-link clicks (no `allow-popups`, no
 *  `allow-top-navigation`), so the in-iframe SDK traps the click and posts the
 *  absolute URL here; the parent (not sandboxed) opens it in a real browser tab.
 *  Mirrors `observeIframeNavigation`/`observeIframeHistory`: a focused listener
 *  with the same `event.source` identity boundary. The payload guard requires a
 *  string `url` that is http(s) AND cross-origin to kolu (the shared
 *  `isCrossOriginHttpUrl`, the same predicate the in-frame classifier runs) — a
 *  hostile in-frame script can post any shape. A non-http URL handed to
 *  `window.open` would run in the parent's origin; a kolu-origin URL (e.g. the
 *  frame's own preview URL) would load the file as an UNSANDBOXED top-level tab.
 *  Returns a disposer. */
export function observeIframeOpenExternal(
  iframe: HTMLIFrameElement,
  onOpenExternal: (url: string) => void,
): () => void {
  return observeFromIframe(
    iframe,
    (msg) =>
      match(msg)
        .with(
          { type: "kolu-artifact-sdk:open-external", url: P.string },
          (m) =>
            isCrossOriginHttpUrl(parseHttpUrl(m.url), window.location.origin)
              ? m.url
              : null,
        )
        .otherwise(() => null),
    onOpenExternal,
  );
}

/** Observe a kolu deep link (`#/…`) clicked inside the previewed document. The
 *  opaque-origin sandbox can't navigate the parent, so the in-iframe SDK traps
 *  the click and posts the raw hash; the parent parses it with its real
 *  deep-link grammar and routes. Mirrors `observeIframeOpenExternal`: the same
 *  `event.source` identity boundary, and a payload guard that bounds the hash
 *  to the `#/` deep-link namespace. A hostile in-frame script can fabricate the
 *  message — accepted because the parent's router is VIEW-ONLY BY LAW (kolu
 *  #1840): the worst a posted hash can do is change the viewer's view or toast
 *  "invalid", never create, kill, write, or send keys. Returns a disposer. */
export function observeIframeDeepLink(
  iframe: HTMLIFrameElement,
  onDeepLink: (hash: string) => void,
): () => void {
  return observeFromIframe(
    iframe,
    (msg) =>
      match(msg)
        .with({ type: "kolu-artifact-sdk:deep-link", hash: P.string }, (m) =>
          isDeepLinkHash(m.hash) ? m.hash : null,
        )
        .otherwise(() => null),
    onDeepLink,
  );
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
