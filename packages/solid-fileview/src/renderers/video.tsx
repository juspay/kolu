/** Video rendered-appliance: a `<video controls>` element centered in a scroll
 *  container. No iframe — the host serves the file with a real `video/*`
 *  Content-Type and HTTP range support, so the native player owns playback and
 *  seeking. Generic and Kolu-free; the host supplies any backdrop via `class`.
 *
 *  `preload="metadata"` fetches just enough to show the first frame + duration
 *  without streaming the whole file on open. `keyed` remounting upstream means
 *  a new `url` (mtime bump on save) mounts a fresh element rather than leaving
 *  a stale media source attached. */

import type { Component } from "solid-js";

export type VideoRendererProps = {
  path: string;
  url: string;
  /** Extra classes for the centering container — e.g. a backdrop the host
   *  defines. */
  class?: string;
};

export const VideoRenderer: Component<VideoRendererProps> = (props) => (
  <div
    data-testid="browse-preview-video"
    class={`flex h-full w-full items-center justify-center overflow-auto p-4 ${props.class ?? ""}`}
  >
    {/* biome-ignore lint/a11y/useMediaCaption: a previewed repo asset has no
        caption track to offer; this is a file viewer, not authored media. */}
    <video
      src={props.url}
      controls
      preload="metadata"
      class="max-h-full max-w-full object-contain"
    >
      {props.path}
    </video>
  </div>
);
