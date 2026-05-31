/** Iframe rendered-appliance: a sandboxed, opaque-origin frame for documents
 *  that may carry scripts (HTML, SVG) or need a native viewer (PDF).
 *
 *  `allow-scripts` WITHOUT `allow-same-origin` runs the page's JS in an
 *  opaque origin — it can't read the host's cookies or localStorage, and
 *  cross-origin `fetch()` from inside is blocked (fine for static-artifact
 *  previews). `postMessage` between parent and frame still works; that's the
 *  channel a host can layer a bridge over via `ref`. */

import type { Component } from "solid-js";

export type IframeRendererProps = {
  path: string;
  url: string;
  /** Receives the iframe element so a host can attach a postMessage bridge
   *  (e.g. kolu's artifact-sdk comment channel). Omit for a plain preview. */
  ref?: (el: HTMLIFrameElement) => void;
};

export const IframeRenderer: Component<IframeRendererProps> = (props) => (
  <iframe
    ref={props.ref}
    data-testid="browse-preview-iframe"
    src={props.url}
    title={props.path}
    sandbox="allow-scripts"
    class="h-full w-full border-0 bg-white"
  />
);
