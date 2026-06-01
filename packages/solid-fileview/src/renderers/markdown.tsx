/** Markdown rendered-appliance: a file's source rendered as a reading
 *  document via `@kolu/solid-markdown`. Unlike the image/iframe appliances,
 *  the rendered form comes from the file's *source text* (Markdown renders
 *  client-side), not a server URL — so this takes the content directly
 *  rather than a `url`. Generic and Kolu-free; the host frames it (the
 *  scroll container + centered reading column live here, the surrounding
 *  toggle chrome in `FileView`). */

import { Markdown } from "@kolu/solid-markdown";
import type { Component } from "solid-js";

export type MarkdownRendererProps = {
  /** The file's UTF-8 Markdown source. */
  markdown: string;
  /** Extra classes for the scroll container — e.g. a host backdrop. */
  class?: string;
};

export const MarkdownRenderer: Component<MarkdownRendererProps> = (props) => (
  <div
    data-testid="browse-preview-markdown"
    class={`h-full w-full overflow-auto p-6 ${props.class ?? ""}`}
  >
    <div class="mx-auto max-w-3xl">
      <Markdown markdown={props.markdown} variant="document" />
    </div>
  </div>
);
