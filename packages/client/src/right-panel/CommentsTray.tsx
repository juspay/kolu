/** Copy-to-clipboard is destructive by design (#878): the tray clears
 *  once the payload is on the clipboard so the next review session
 *  starts empty. */

import type { SelectedLineRange } from "@kolu/solid-pierre";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "../terminal/clipboard";
import { CloseIcon } from "../ui/Icons";
import { formatLineRange, serializeComments } from "./commentSerialize";
import type { CommentsApi } from "./useComments";

/** Test-id surface for `CommentsTray`. Centralizes the strings the
 *  markup writes so a typo lands as a TypeScript error rather than a
 *  silently-skipped Playwright locator. E2e step files mirror the
 *  values as literal strings (the tests package doesn't import client
 *  internals) — drift surfaces as an e2e failure. */
export const commentsTestIds = {
  tray: "comments-tray",
  composer: "comments-composer",
  target: "comments-target",
  add: "comments-add",
  copy: "comments-copy",
  close: "comments-close",
  list: "comments-list",
  item: "comments-item",
} as const;

const TRAY_PRIMARY_BUTTON_CLASS =
  "px-2 h-5 rounded text-[10px] bg-accent/80 text-bg-0 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed";

export type CommentsTrayProps = {
  api: CommentsApi;
  /** Path of the file currently open in the viewer, or null when no
   *  file is selected. Drives the composer's target chip. */
  currentPath: () => string | null;
  /** Pierre's current line selection inside the viewer, or null when
   *  nothing is selected. Drives the composer's target chip + the
   *  "Add" button enablement. */
  currentRange: () => SelectedLineRange | null;
  /** Toggle comment mode off — closes the tray when there are no queued
   *  comments. */
  onClose: () => void;
};

const CommentsTray: Component<CommentsTrayProps> = (props) => {
  const [draft, setDraft] = createSignal("");
  // Memoize so each render and child binding shares one tracked read,
  // not six fresh subscriptions through the bucket Map.
  const comments = createMemo(() => props.api.comments());

  const canAdd = () =>
    props.currentPath() !== null &&
    props.currentRange() !== null &&
    draft().trim().length > 0;

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
      text: draft().trim(),
    });
    setDraft("");
  };

  const copyAndClear = async () => {
    const list = comments();
    if (list.length === 0) return;
    const payload = serializeComments(list);
    try {
      // writeTextToClipboard falls back to document.execCommand("copy")
      // when navigator.clipboard is unavailable (non-secure context).
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

  return (
    <div
      class="shrink-0 flex flex-col border-t border-edge bg-surface-1/30 text-[11px] max-h-[40%]"
      data-testid={commentsTestIds.tray}
    >
      <div class="flex items-center h-7 px-2 border-b border-edge shrink-0 gap-2">
        <span class="font-medium text-fg-2">
          Comments ({comments().length})
        </span>
        <div class="flex-1" />
        <button
          type="button"
          class={TRAY_PRIMARY_BUTTON_CLASS}
          disabled={comments().length === 0}
          onClick={copyAndClear}
          data-testid={commentsTestIds.copy}
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          class="p-1 rounded text-fg-3/70 hover:text-fg-2 hover:bg-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
          // Disable when queued — `disableCommentMode` is no-op'd by
          // the OR-arm of `trayVisible`, so the click would silently fail.
          disabled={comments().length > 0}
          onClick={props.onClose}
          aria-label="Close comments tray"
          title={
            comments().length > 0
              ? "Clear or copy comments before closing the tray"
              : "Close comments tray"
          }
          data-testid={commentsTestIds.close}
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
                data-testid={commentsTestIds.target}
              >
                {label()}
              </div>
              <textarea
                class="w-full min-h-[40px] max-h-[120px] resize-y rounded border border-edge bg-bg-0 px-2 py-1 text-fg-2 placeholder:text-fg-3/40 focus:outline-none focus:border-accent"
                placeholder="Note for the agent…"
                value={draft()}
                onInput={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  // Cmd/Ctrl+Enter submits — newline by default so multi-line
                  // notes stay easy to write.
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
                data-testid={commentsTestIds.composer}
              />
              <div class="flex justify-end">
                <button
                  type="button"
                  class={TRAY_PRIMARY_BUTTON_CLASS}
                  disabled={!canAdd()}
                  onClick={submit}
                  data-testid={commentsTestIds.add}
                >
                  Add comment
                </button>
              </div>
            </div>
          )}
        </Show>
      </div>

      <div
        class="flex-1 min-h-0 overflow-auto"
        data-testid={commentsTestIds.list}
      >
        <Show
          when={comments().length > 0}
          fallback={
            <div class="px-2 py-3 text-fg-3/40 text-center text-[10px]">
              No comments yet.
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
