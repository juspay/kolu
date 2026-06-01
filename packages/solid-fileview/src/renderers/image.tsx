/** Image rendered-appliance: a plain `<img>` centered in a scroll
 *  container. No iframe — image bytes can't execute, so there's no sandbox
 *  to set up. Generic and Kolu-free; the host supplies any backdrop (e.g. a
 *  checkerboard so transparency reads) via `class`. */

import type { Component } from "solid-js";

export type ImageRendererProps = {
  path: string;
  url: string;
  /** Extra classes for the centering container — e.g. a transparency
   *  checkerboard the host defines. */
  class?: string;
};

export const ImageRenderer: Component<ImageRendererProps> = (props) => (
  <div
    data-testid="browse-preview-image"
    class={`flex h-full w-full items-center justify-center overflow-auto p-4 ${props.class ?? ""}`}
  >
    <img
      src={props.url}
      alt={props.path}
      class="max-h-full max-w-full object-contain"
    />
  </div>
);
