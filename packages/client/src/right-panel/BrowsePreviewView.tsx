/** Iframe presenter for binary previewable files (`.html`, `.svg`, `.pdf`).
 *  Receives a server-built URL the iframe `src`-binds to; URL re-binds when
 *  the file changes (server bumps the `?v=<mtime>` query on save), so the
 *  iframe reloads via the same `fsReadFile` subscription path as text. No
 *  state, no subscription — `BrowseFileDispatcher` owns both.
 *
 *  Comments wiring (HTML only — SVG/PDF served verbatim by the route):
 *  the server splices `<script src="/api/artifact-sdk.js?v=<hash>">` into
 *  text/html responses. The SDK runs inside the opaque-origin iframe and
 *  postMessages selection captures up to `bindArtifactSdk`, which opens
 *  the shared composer over the iframe. Same store, same tray.
 *
 *  Security: parent ↔ iframe communicates by postMessage only. The bridge
 *  validates by `event.source === iframeRef.contentWindow` since
 *  `event.origin` is the literal `"null"` under opaque sandbox. */

import {
  bindArtifactSdk,
  pushHighlightsTo,
  pushPathTo,
} from "@kolu/artifact-sdk/client";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { useComposer } from "../comments/composerState";
import { useComments } from "../comments/useComments";

export type BrowsePreviewViewProps = {
  repoRoot: string;
  filePath: string;
  url: string;
};

const BrowsePreviewView: Component<BrowsePreviewViewProps> = (props) => {
  const composer = useComposer();
  const [iframeEl, setIframeEl] = createSignal<HTMLIFrameElement | undefined>();
  const comments = useComments(props.repoRoot);
  const commentsForFile = createMemo(() =>
    comments
      .commentsForPath(props.filePath)
      .map((c) => ({ id: c.id, locator: c.locator })),
  );

  createEffect(() => {
    const el = iframeEl();
    if (!el) return;
    const dispose = bindArtifactSdk(el, {
      currentPath: () => props.filePath,
      commentsForPath: () => commentsForFile(),
      onSelect: (msg) => {
        composer.open({
          path: msg.path,
          locator: msg.locator,
          // Translate iframe-local coordinates to parent viewport so the
          // composer Portal lands over the visible selection rather than
          // the iframe's top-left corner.
          rect: {
            x: el.getBoundingClientRect().left + msg.rect.x,
            y: el.getBoundingClientRect().top + msg.rect.y,
            width: msg.rect.width,
            height: msg.rect.height,
          },
        });
      },
    });
    onCleanup(dispose);
  });

  // Push fresh comment set into the iframe whenever it changes — the
  // SDK re-applies CSS Custom Highlights with the new range list.
  createEffect(() => {
    const el = iframeEl();
    const list = commentsForFile();
    if (!el) return;
    pushHighlightsTo(el, list);
  });

  // Push the path on any url/path change too — handles in-iframe nav.
  createEffect(() => {
    const el = iframeEl();
    if (!el) return;
    pushPathTo(el, props.filePath);
  });

  return (
    <iframe
      ref={setIframeEl}
      data-testid="browse-preview-iframe"
      src={props.url}
      title={props.filePath}
      // `allow-scripts` runs the page's JS in an opaque origin (no
      // `allow-same-origin`), so the iframe can't read Kolu's cookies or
      // localStorage. Cross-origin `fetch()` from inside is blocked —
      // acceptable for static-artifact previews; documented in the PR.
      // postMessage between parent and iframe still works (it was
      // designed for cross-origin) — that's the channel the artifact-sdk
      // uses for selection capture + highlight rendering.
      sandbox="allow-scripts"
      class="w-full h-full border-0 bg-white"
    />
  );
};

export default BrowsePreviewView;
