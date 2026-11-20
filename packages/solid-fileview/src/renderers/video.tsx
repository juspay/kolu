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
