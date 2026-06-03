/** Markdown rendered-appliance: a file's source rendered as a reading
 *  document via `@kolu/solid-markdown`. Unlike the image/iframe appliances,
 *  the rendered form comes from the file's *source text* (Markdown renders
 *  client-side), not a server URL — so this takes the content directly
 *  rather than a `url`. Generic and Kolu-free; the host frames it (the
 *  scroll container + centered reading column live here, the surrounding
 *  toggle chrome in `FileView`). */

import { Markdown } from "@kolu/solid-markdown";
import { type Component, Show } from "solid-js";

export type MarkdownRendererProps = {
  /** The file's UTF-8 Markdown source. */
  markdown: string;
  /** True if the source was truncated server-side (exceeds the size limit).
   *  When set, only a prefix of the document is rendered, so we surface the
   *  same warning the source view shows rather than silently presenting a
   *  partial document. */
  truncated?: boolean;
  /** Extra classes for the scroll container — e.g. a host backdrop. */
  class?: string;
  /** Resolve a repo-relative image `src` to a loadable URL (see
   *  `@kolu/solid-markdown`'s `resolveImageSrc`). The host wires this to its
   *  file-serving route so README images render instead of falling back. */
  resolveImageSrc?: (src: string) => string | undefined;
  /** Persist a task-list checkbox toggle (see `@kolu/solid-markdown`'s
   *  `onToggleTask`). The host writes the flipped source back to the file;
   *  omit to keep checkboxes presentational. */
  onToggleTask?: (taskIndex: number) => void;
};

export const MarkdownRenderer: Component<MarkdownRendererProps> = (props) => (
  <div
    data-testid="browse-preview-markdown"
    class={`h-full w-full overflow-auto ${props.class ?? ""}`}
  >
    <Show when={props.truncated}>
      <div class="px-2 py-1 text-warning text-[10px] border-b border-edge bg-surface-1/30">
        File truncated (exceeds 1 MB)
      </div>
    </Show>
    <div class="mx-auto max-w-3xl p-6 text-fg sm:p-8">
      <Markdown
        markdown={props.markdown}
        variant="document"
        resolveImageSrc={props.resolveImageSrc}
        onToggleTask={props.onToggleTask}
      />
    </div>
  </div>
);
