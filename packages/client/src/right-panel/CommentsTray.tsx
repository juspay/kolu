/** Comments tray — the bottom strip of the Code tab when comment mode is
 *  active OR the user has comments queued from a previous session.
 *
 *  Composer wires the active file's selected line range into "Add comment".
 *  The list groups by path (sorted via `serializeComments` semantics) so
 *  what the user sees mirrors what gets pasted.
 *
 *  Copy-to-clipboard is destructive by design (per #878): users want the
 *  tray to clear once the comments are pasted into an agent prompt, so
 *  the next review session starts empty. A solid-sonner toast confirms
 *  the count and provides feedback if `navigator.clipboard` rejects.  */

import type { SelectedLineRange } from "@kolu/solid-pierre";
import { type Component, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { CloseIcon } from "../ui/Icons";
import { formatLineRange, serializeComments } from "./commentSerialize";
import type { CommentsApi } from "./useComments";

export type CommentsTrayProps = {
  api: CommentsApi;
  /** Path of the file currently open in the viewer, or null when no
   *  file is selected. Drives the composer's target chip. */
  currentPath: () => string | null;
  /** Pierre's current line selection inside the viewer, or null when
   *  nothing is selected. Drives the composer's target chip + the
   *  "Add" button enablement. */
  currentRange: () => SelectedLineRange | null;
  /** Composer text, lifted to CodeTab so it survives tray remounts. */
  draft: () => string;
  setDraft: (value: string) => void;
  /** Toggle comment mode off — closes the tray when there are no queued
   *  comments. */
  onClose: () => void;
};

const CommentsTray: Component<CommentsTrayProps> = (props) => {
  const canAdd = () =>
    props.currentPath() !== null &&
    props.currentRange() !== null &&
    props.draft().trim().length > 0;

  const targetLabel = () => {
    const p = props.currentPath();
    const r = props.currentRange();
    if (!p || !r) return null;
    return `${p}  ${formatLineRange(r.start, r.end)}`;
  };

  const submit = () => {
    if (!canAdd()) return;
    const p = props.currentPath();
    const r = props.currentRange();
    if (!p || !r) return;
    props.api.addComment({
      path: p,
      startLine: r.start,
      endLine: r.end,
      text: props.draft().trim(),
    });
    props.setDraft("");
  };

  const copyAndClear = async () => {
    const list = props.api.comments();
    if (list.length === 0) return;
    const payload = serializeComments(list);
    try {
      await navigator.clipboard.writeText(payload);
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

  return (
    <div
      class="shrink-0 flex flex-col border-t border-edge bg-surface-1/30 text-[11px] max-h-[40%]"
      data-testid="comments-tray"
    >
      <div class="flex items-center h-7 px-2 border-b border-edge shrink-0 gap-2">
        <span class="font-medium text-fg-2">
          Comments ({props.api.comments().length})
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class="px-2 h-5 rounded text-[10px] bg-accent/80 text-bg-0 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={props.api.comments().length === 0}
          onClick={copyAndClear}
          data-testid="comments-copy"
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          class="p-1 rounded text-fg-3/70 hover:text-fg-2 hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
          // Tray visibility is `commentMode OR comments.length > 0`. With
          // queued comments, disabling comment-mode would no-op (the
          // second arm keeps the tray open) — the click would silently
          // do nothing. Disable the button instead, so the user clears
          // or copy-and-clears first.
          disabled={props.api.comments().length > 0}
          onClick={props.onClose}
          aria-label="Close comments tray"
          title={
            props.api.comments().length > 0
              ? "Clear or copy comments before closing the tray"
              : "Close comments tray"
          }
          data-testid="comments-close"
        >
          <CloseIcon class="w-3 h-3" />
        </button>
      </div>

      <div class="px-2 py-2 border-b border-edge shrink-0">
        <Show
          when={targetLabel()}
          fallback={
            <div class="text-fg-3/50 italic text-[10px]">
              Select lines in the file viewer to attach a comment.
            </div>
          }
        >
          {(label) => (
            <div class="flex flex-col gap-1.5">
              <div
                class="font-mono text-[10px] text-fg-3 truncate"
                data-testid="comments-target"
              >
                {label()}
              </div>
              <textarea
                class="w-full min-h-[40px] max-h-[120px] resize-y rounded border border-edge bg-bg-0 px-2 py-1 text-fg-2 placeholder:text-fg-3/40 focus:outline-none focus:border-accent"
                placeholder="Note for the agent…"
                value={props.draft()}
                onInput={(e) => props.setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter submits — newline by default so multi-line
                  // notes stay easy to write.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
                data-testid="comments-composer"
              />
              <div class="flex justify-end">
                <button
                  type="button"
                  class="px-2 h-5 rounded text-[10px] bg-accent/80 text-bg-0 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
                  disabled={!canAdd()}
                  onClick={submit}
                  data-testid="comments-add"
                >
                  Add comment
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>

      <div class="flex-1 min-h-0 overflow-auto" data-testid="comments-list">
        <Show
          when={props.api.comments().length > 0}
          fallback={
            <div class="px-2 py-3 text-fg-3/40 text-center text-[10px]">
              No comments yet.
            </div>
          }
        >
          <ul class="flex flex-col">
            <For each={props.api.comments()}>
              {(c) => (
                <li
                  class="flex flex-col gap-0.5 px-2 py-1.5 border-b border-edge/40 last:border-b-0"
                  data-testid="comments-item"
                  data-path={c.path}
                >
                  <div class="flex items-baseline gap-1.5">
                    <span class="font-mono text-[10px] text-fg-3 truncate flex-1">
                      {c.path} {formatLineRange(c.startLine, c.endLine)}
                    </span>
                    <button
                      type="button"
                      class="p-0.5 rounded text-fg-3/60 hover:text-danger hover:bg-surface-1"
                      onClick={() => props.api.removeComment(c.id)}
                      aria-label="Remove comment"
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
