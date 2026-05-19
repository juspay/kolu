/** Iframe presenter for binary previewable files (`.html`, `.svg`, `.pdf`).
 *  Receives a server-built URL the iframe `src`-binds to; URL re-binds when
 *  the file changes (server bumps the `?v=<mtime>` query on save), so the
 *  iframe reloads via the same `fsReadFile` subscription path as text.
 *
 *  Comments wiring (HTML only — SVG/PDF served verbatim by the route):
 *  the server splices `<script src="/api/artifact-sdk.js?v=<hash>">` into
 *  text/html responses. `CommentIframeSurface` owns the parent ↔ iframe
 *  bridge (selection capture + highlight push); this component is just
 *  the iframe element + its sandbox config.
 *
 *  Security: parent ↔ iframe communicates by postMessage only. The bridge
 *  validates by `event.source === iframe.contentWindow` since
 *  `event.origin` is the literal `"null"` under opaque sandbox. */

import { type Component, createSignal } from "solid-js";
import { CommentIframeSurface } from "../comments/CommentIframeSurface";

export type BrowsePreviewViewProps = {
  terminalId: string;
  filePath: string;
  url: string;
};

const BrowsePreviewView: Component<BrowsePreviewViewProps> = (props) => {
  const [iframeEl, setIframeEl] = createSignal<HTMLIFrameElement | undefined>();

  return (
    <>
      <iframe
        ref={setIframeEl}
        data-testid="browse-preview-iframe"
        src={props.url}
        title={props.filePath}
        // `allow-scripts` runs the page's JS in an opaque origin (no
        // `allow-same-origin`), so the iframe can't read Kolu's cookies
        // or localStorage. Cross-origin `fetch()` from inside is blocked
        // — acceptable for static-artifact previews. postMessage between
        // parent and iframe still works (it was designed for cross-origin)
        // — that's the channel the artifact-sdk uses for selection
        // capture + highlight rendering.
        sandbox="allow-scripts"
        class="w-full h-full border-0 bg-white"
      />
      <CommentIframeSurface
        terminalId={props.terminalId}
        path={props.filePath}
        iframe={iframeEl()}
      />
    </>
  );
};

export default BrowsePreviewView;
