/** Read-only roll-up of the queued comments. The compose flow lives in
 *  `InlineCommentPopover` (anchored at the selected line); this tray is
 *  the discovery + bulk-action surface:
 *
 *    - Click a line ref → jump back to that file/line (calls `onJumpTo`).
 *    - Pencil → re-open the composer in edit mode at that comment.
 *    - Trash → drop one comment.
 *    - Copy → serialise + clear (destructive by design, #878).
 *
 *  The header bar gets an accent fill when count > 0 so the user
 *  doesn't accidentally ignore the queue. */

import { type Component, createMemo, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "../terminal/clipboard";
import { CloseIcon } from "../ui/Icons";
import { formatLPathRef } from "../ui/lineRef";
import type { Comment } from "./commentSerialize";
import { serializeComments } from "./commentSerialize";
import type { CommentsApi } from "./useComments";

export const commentsTestIds = {
  tray: "comments-tray",
  copy: "comments-copy",
  close: "comments-close",
  list: "comments-list",
  item: "comments-item",
  jump: "comments-jump",
  edit: "comments-edit",
  remove: "comments-remove",
} as const;

const TRAY_PRIMARY_BUTTON_CLASS =
  "px-2 h-5 rounded text-[10px] bg-accent/80 text-bg-0 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed";

export type CommentsTrayProps = {
  api: CommentsApi;
  /** Jump-to-line — called when the user clicks a comment's line ref.
   *  Caller should switch to the comment's file (browse mode) and
   *  push Pierre's selection to the range so the line is highlighted. */
  onJumpTo: (comment: Comment) => void;
  /** Edit request — opens the inline popover in edit mode at the
   *  comment's line. Caller orchestrates the file switch + selection
   *  push, same as `onJumpTo`, plus the popover open. */
  onEdit: (comment: Comment) => void;
  /** Toggle comment mode off — only meaningful when the queue is
   *  empty; the close button is disabled otherwise so the user can't
   *  hide a populated tray by accident. */
  onClose: () => void;
};

const CommentsTray: Component<CommentsTrayProps> = (props) => {
  // Memoize so each render and child binding shares one tracked read,
  // not six fresh subscriptions through the bucket Map.
  const comments = createMemo(() => props.api.comments());

  const copyAndClear = async () => {
    const list = comments();
    if (list.length === 0) return;
    const payload = serializeComments(list);
    try {
      await writeTextToClipboard(payload);
      const n = list.length;
      props.api.clear();
      toast.success(
        `Copied ${n} comment${n === 1 ? "" : "s"} to clipboard. Tray cleared.`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Clipboard write failed: ${message}`);
    }
  };

  const hasItems = () => comments().length > 0;

  return (
    <div
      class="shrink-0 flex flex-col border-t border-edge bg-surface-1/30 text-[11px] max-h-[40%]"
      data-testid={commentsTestIds.tray}
    >
      <div
        // Accent stripe on the header bar when the queue is non-empty
        // so the user can't accidentally ignore it. `richColors` on the
        // Toaster doesn't apply here; we paint the tray ourselves.
        class="flex items-center h-7 px-2 border-b border-edge shrink-0 gap-2 transition-colors"
        classList={{
          "bg-accent/15 border-accent/40": hasItems(),
        }}
      >
        <span
          class="font-medium"
          classList={{
            "text-accent": hasItems(),
            "text-fg-2": !hasItems(),
          }}
        >
          Comments ({comments().length})
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class={TRAY_PRIMARY_BUTTON_CLASS}
          disabled={!hasItems()}
          onClick={copyAndClear}
          data-testid={commentsTestIds.copy}
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          class="p-1 rounded text-fg-3/70 hover:text-fg-2 hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={hasItems()}
          onClick={props.onClose}
          aria-label="Close comments tray"
          title={
            hasItems()
              ? "Clear or copy comments before closing the tray"
              : "Close comments tray"
          }
          data-testid={commentsTestIds.close}
        >
          <CloseIcon class="w-3 h-3" />
        </button>
      </div>

      <div
        class="flex-1 min-h-0 overflow-auto"
        data-testid={commentsTestIds.list}
      >
        <Show
          when={hasItems()}
          fallback={
            <div class="px-2 py-3 text-fg-3/40 text-center text-[10px]">
              Select a line in comment mode to add a note.
            </div>
          }
        >
          <ul class="flex flex-col">
            <For each={comments()}>
              {(c) => (
                <li
                  class="flex flex-col gap-0.5 px-2 py-1.5 border-b border-edge/40 last:border-b-0"
                  data-testid={commentsTestIds.item}
                  data-path={c.path}
                >
                  <div class="flex items-baseline gap-1.5">
                    <button
                      type="button"
                      class="font-mono text-[10px] text-fg-3 truncate flex-1 text-left hover:text-accent hover:underline"
                      onClick={() => props.onJumpTo(c)}
                      title="Jump to this line"
                      data-testid={commentsTestIds.jump}
                    >
                      {formatLPathRef(c.path, c.startLine, c.endLine)}
                    </button>
                    <button
                      type="button"
                      class="p-0.5 rounded text-fg-3/60 hover:text-accent hover:bg-surface-1"
                      onClick={() => props.onEdit(c)}
                      aria-label="Edit comment"
                      title="Edit"
                      data-testid={commentsTestIds.edit}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      class="p-0.5 rounded text-fg-3/60 hover:text-danger hover:bg-surface-1"
                      onClick={() => props.api.removeComment(c.id)}
                      aria-label="Remove comment"
                      data-testid={commentsTestIds.remove}
                    >
                      <CloseIcon class="w-2.5 h-2.5" />
                    </button>
                  </div>
                  <div class="text-fg-2 whitespace-pre-wrap break-words">
                    {c.text}
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </div>
  );
};

export default CommentsTray;
