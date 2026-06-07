/** Video rendered-appliance: a `<video controls>` element centered in a scroll
 *  container. No iframe — the host serves the file with a real `video/*`
 *  Content-Type and HTTP range support, so the native player owns playback and
 *  seeking. Generic and Kolu-free; the host supplies any backdrop via `class`.
 *
 *  `preload="metadata"` fetches just enough to show the first frame + duration
 *  without streaming the whole file on open. The `url` carries `?v=<mtime>`, so
 *  a save reactively updates `src` (FileView re-renders this appliance on a
 *  fresh `FileData`) and the player reloads from the new URL — no stale source
 *  lingers. Selecting a different file remounts the whole subtree (CodeTab keys
 *  its preview by selected path), so element identity is fresh across files. */

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
      title={props.path}
      aria-label={props.path}
      class="max-h-full max-w-full object-contain"
    >
      {props.path}
    </video>
  </div>
);
