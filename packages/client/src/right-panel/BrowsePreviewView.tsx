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

import { type Component, createSignal, Show } from "solid-js";
import { CommentIframeSurface } from "../comments/CommentIframeSurface";
import { isRasterImage } from "./imageFile";

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
          class="flex h-full w-full items-center justify-center overflow-auto p-4"
          // Checkerboard so transparent PNGs read against the dark panel
          // (the canonical four-gradient pattern); `object-contain` below
          // fits the image without cropping or upscaling. Inline rather
          // than a Tailwind class because the v4 `theme()`-in-arbitrary
          // idiom is unreliable and there's no in-repo precedent for it.
          style={{
            "background-image":
              "linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%), linear-gradient(-45deg, rgba(255,255,255,0.05) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.05) 75%), linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.05) 75%)",
            "background-size": "20px 20px",
            "background-position": "0 0, 0 10px, 10px -10px, -10px 0",
          }}
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
