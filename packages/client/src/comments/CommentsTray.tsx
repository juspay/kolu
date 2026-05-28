/** Bottom strip mounted under the Code tab content. Lists all comments
 *  for the active repoRoot across every file (browse + branch diff + HTML
 *  iframe artifacts). "Copy to clipboard" flushes the queue as Markdown
 *  and clears it.
 *
 *  Hidden when the queue is empty — no toggle, no mode. Visibility =
 *  `comments.length > 0` by construction. */

import { type Component, createMemo, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "@kolu/browser-clipboard";
import { formatMarkdown } from "./formatMarkdown";
import type { Comment } from "./types";
import { useComments } from "./useComments";

export type CommentsTrayProps = {
  terminalId: string;
  /** Click a tray item to jump to its file (and trigger scroll-to-quote
   *  via the highlight overlay's resolved Range on the destination). */
  onJumpTo?: (comment: Comment) => void;
};

export const CommentsTray: Component<CommentsTrayProps> = (props) => {
  // `createMemo` re-derives the store when `props.terminalId` changes —
  // switching to a different terminal swaps the visible queue, and any
  // race between meta resolution and mount can't lock the tray onto a
  // stale key (the same trap the previous `const store = ...` form had).
  const store = createMemo(() => useComments(props.terminalId));

  const copy = async (): Promise<void> => {
    const list = store().comments();
    if (list.length === 0) return;
    const text = formatMarkdown(list);
    try {
      await writeTextToClipboard(text);
      toast.success(
        `Copied ${list.length} comment${list.length === 1 ? "" : "s"} to clipboard`,
      );
      store().clear();
    } catch (err) {
      console.error("Failed to copy comments:", err);
      toast.error(`Failed to copy: ${(err as Error).message}`);
    }
  };

  return (
    <Show when={store().comments().length > 0}>
      <div
        class="border-t border-edge bg-surface-2 px-3 py-2 text-[12px] font-sans shrink-0 max-h-[40vh] overflow-auto"
        data-testid="kolu-comments-tray"
      >
        <div class="flex items-baseline justify-between mb-1.5">
          <div>
            <strong class="text-[11px] uppercase tracking-wider text-fg-2 font-semibold">
              Comments
            </strong>
            <span class="font-mono text-[11px] text-fg-3 ml-1.5">
              {store().comments().length} queued
            </span>
          </div>
          <button
            type="button"
            onClick={() => store().clear()}
            class="text-[11px] text-fg-3 hover:text-fg-2 px-1.5"
          >
            Discard all
          </button>
        </div>
        <ul class="list-none p-0 m-0">
          <For each={store().comments()}>
            {(c) => (
              <li class="bg-surface-1 border border-edge rounded-sm px-2 py-1.5 mb-1 grid grid-cols-[1fr_auto] gap-2 items-start">
                <button
                  type="button"
                  onClick={() => props.onJumpTo?.(c)}
                  class="text-left w-full"
                  data-testid="kolu-tray-item"
                >
                  <div class="font-mono text-[11px] text-fg-2 truncate">
                    <span class="text-fg">{c.path}</span>
                  </div>
                  <div class="font-mono italic text-[11px] text-fg-3 mt-0.5 truncate">
                    "{c.locator.quote}"
                  </div>
                  <div class="text-fg text-[12px] mt-1 whitespace-pre-wrap break-words">
                    {c.body}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => store().remove(c.id)}
                  aria-label={`Remove comment on ${c.path}`}
                  class="text-fg-3 text-[14px] self-center px-1 hover:text-fg-2"
                >
                  ×
                </button>
              </li>
            )}
          </For>
        </ul>
        <div class="flex gap-1.5 items-center mt-2">
          <button
            type="button"
            onClick={copy}
            data-testid="kolu-tray-copy"
            class="px-2.5 py-1 text-[11px] rounded-sm border border-accent bg-accent text-white hover:opacity-90"
          >
            Copy to clipboard
          </button>
          <span class="text-[11px] text-fg-3 ml-auto">
            Flushes &amp; clears the queue.
          </span>
        </div>
      </div>
    </Show>
  );
};

export default CommentsTray;
