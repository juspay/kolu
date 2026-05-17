/** Iframe presenter for binary previewable files (`.html`, `.svg`, `.pdf`).
 *  Receives a server-built URL the iframe `src`-binds to; URL re-binds when
 *  the file changes (server bumps the `?v=<mtime>` query on save), so the
 *  iframe reloads via the same `fsReadFile` subscription path as text. No
 *  state, no subscription — `BrowseFileDispatcher` owns both. */

import type { Component } from "solid-js";

export type BrowsePreviewViewProps = {
  filePath: string;
  url: string;
};

const BrowsePreviewView: Component<BrowsePreviewViewProps> = (props) => {
  return (
    <iframe
      data-testid="browse-preview-iframe"
      src={props.url}
      title={props.filePath}
      // `allow-scripts` runs the page's JS in an opaque origin (no
      // `allow-same-origin`), so the iframe can't read Kolu's cookies or
      // localStorage. Cross-origin `fetch()` from inside is blocked —
      // acceptable for static-artifact previews; documented in the PR.
      sandbox="allow-scripts"
      class="w-full h-full border-0 bg-white"
    />
  );
};

export default BrowsePreviewView;
