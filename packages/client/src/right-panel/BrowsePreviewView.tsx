/** Presenter for binary previewable files served by the file route. Two
 *  renderers, picked from the extension below the `fsReadFile` wire
 *  boundary (the server classifies all of these as `kind: "binary"`):
 *
 *    - Raster images (`.png`/`.jpg`/…) → a plain `<img>`, centered on a
 *      checkerboard so transparency reads. No iframe, no comment bridge —
 *      raster bytes never carried the spliced artifact-sdk script anyway.
 *    - `.html`/`.svg`/`.pdf` → sandboxed iframe (SVG can carry scripts, so
 *      it must stay in the `allow-scripts`-only opaque-origin sandbox).
 *
 *  Receives a server-built URL the renderer `src`-binds to; URL re-binds
 *  when the file changes (server bumps the `?v=<mtime>` query on save), so
 *  the preview reloads via the same `fsReadFile` subscription path as text.
 *
 *  Comments wiring (HTML only — SVG/PDF served verbatim by the route):
 *  the server splices `<script src="/api/artifact-sdk.js?v=<hash>">` into
 *  text/html responses. `CommentIframeSurface` owns the parent ↔ iframe
 *  bridge (selection capture + highlight push).
 *
 *  Security: parent ↔ iframe communicates by postMessage only. The bridge
 *  validates by `event.source === iframe.contentWindow` since
 *  `event.origin` is the literal `"null"` under opaque sandbox. */

import { isRasterImage } from "kolu-git/previewable";
import { type Component, createSignal, Show } from "solid-js";
import { CommentIframeSurface } from "../comments/CommentIframeSurface";

export type BrowsePreviewViewProps = {
  terminalId: string;
  filePath: string;
  url: string;
};

const BrowsePreviewView: Component<BrowsePreviewViewProps> = (props) => {
  const [iframeEl, setIframeEl] = createSignal<HTMLIFrameElement | undefined>();

  return (
    <Show
      when={!isRasterImage(props.filePath)}
      fallback={
        <div
          data-testid="browse-preview-image"
          // `image-preview-checkerboard` is a CSS class in `index.css` —
          // Tailwind's bg-[image:...] arbitrary form cannot line-break
          // a four-gradient value, so it lives in the stylesheet instead.
          class="image-preview-checkerboard flex h-full w-full items-center justify-center overflow-auto p-4"
        >
          <img
            src={props.url}
            alt={props.filePath}
            class="max-h-full max-w-full object-contain"
          />
        </div>
      }
    >
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
    </Show>
  );
};

export default BrowsePreviewView;
