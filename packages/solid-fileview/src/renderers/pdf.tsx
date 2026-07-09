/** PDF rendered-appliance: an unsandboxed iframe that lets the browser's
 *  built-in PDF viewer own rendering, zooming, paging, and downloads.
 *
 *  This renderer is only for bytes the host has already classified as
 *  `application/pdf`. It is deliberately separate from the HTML/SVG sandboxed
 *  iframe: Chromium's PDF viewer does not instantiate inside Kolu's
 *  opaque-origin `allow-scripts` sandbox, which shows a broken-document icon
 *  instead of the file. */

import type { Component } from "solid-js";

export type PdfRendererProps = {
  path: string;
  url: string;
  /** Extra classes for the host to adjust the viewer surface. */
  class?: string;
};

export const PdfRenderer: Component<PdfRendererProps> = (props) => (
  <iframe
    data-testid="browse-preview-pdf"
    src={props.url}
    title={props.path}
    class={`h-full w-full border-0 bg-white ${props.class ?? ""}`}
  />
);
