/** Inline composer used both by the line-anchored popover (new comment)
 *  and the edit affordance from the tray (existing comment). One widget,
 *  two modes — distinguished by whether `initialText` is set. Submit
 *  shortcut is Enter (Shift+Enter for newline); Cmd+Enter is reserved
 *  for the "New terminal" global keybind so we don't want to collide. */

import { type Component, createSignal, onMount } from "solid-js";
import { formatLPathRef } from "../ui/lineRef";

export const composerTestIds = {
  root: "comment-composer",
  textarea: "comment-composer-textarea",
  submit: "comment-composer-submit",
  cancel: "comment-composer-cancel",
} as const;

export type CommentComposerProps = {
  /** Target line range — drives the `path:Lrange` chip at the top. */
  path: string;
  startLine: number;
  endLine: number;
  /** Text to pre-fill (edit mode). Empty string for the new-comment
   *  case. */
  initialText: string;
  /** Submit handler — receives the trimmed text. The composer does not
   *  reset on submit; the parent unmounts (or swaps `initialText`) for
   *  the next operation. */
  onSubmit: (text: string) => void;
  /** Cancel handler — fires on Esc, blur-without-text in new mode, or
   *  the explicit cancel button. */
  onCancel: () => void;
  /** Optional ref handle for the parent to focus the textarea (e.g.
   *  when re-mounted at a new range). */
  ref?: (api: { focus: () => void }) => void;
};

const CommentComposer: Component<CommentComposerProps> = (props) => {
  const [draft, setDraft] = createSignal(props.initialText);
  let textarea: HTMLTextAreaElement | undefined;

  // Expose focus() so the parent can refocus when re-anchoring without
  // remounting (e.g. user re-selects another line while popover open).
  onMount(() => {
    props.ref?.({ focus: () => textarea?.focus() });
    textarea?.focus();
    // Place caret at the end so edit-mode prefilled text is immediately
    // appendable, not selected-and-overwritable.
    const len = textarea?.value.length ?? 0;
    textarea?.setSelectionRange(len, len);
  });

  const submit = () => {
    const text = draft().trim();
    if (text.length === 0) {
      props.onCancel();
      return;
    }
    props.onSubmit(text);
  };

  return (
    <div
      class="rounded-md border border-edge bg-surface-1 shadow-lg p-2 text-[11px] w-[280px] flex flex-col gap-1.5"
      data-testid={composerTestIds.root}
    >
      <div class="font-mono text-[10px] text-fg-3 truncate">
        {formatLPathRef(props.path, props.startLine, props.endLine)}
      </div>
      <textarea
        ref={textarea}
        class="w-full min-h-[48px] max-h-[140px] resize-y rounded border border-edge bg-bg-0 px-2 py-1 text-fg-2 placeholder:text-fg-3/40 focus:outline-none focus:border-accent"
        placeholder="Note for the agent…"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            props.onCancel();
            return;
          }
          // Enter submits unless Shift is held (newline). Cmd/Ctrl+Enter
          // is intentionally NOT bound — the global "New terminal" action
          // owns it. Plain Enter is the friendlier shortcut anyway: most
          // comments are one line, multi-line authors reach for Shift.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        data-testid={composerTestIds.textarea}
      />
      <div class="flex justify-end gap-1.5">
        <button
          type="button"
          class="px-2 h-5 rounded text-[10px] text-fg-3 hover:text-fg-2 hover:bg-surface-2"
          onClick={props.onCancel}
          data-testid={composerTestIds.cancel}
        >
          Esc ✕
        </button>
        <button
          type="button"
          class="px-2 h-5 rounded text-[10px] bg-accent/80 text-bg-0 hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={draft().trim().length === 0}
          onClick={submit}
          data-testid={composerTestIds.submit}
        >
          Enter ↵
        </button>
      </div>
    </div>
  );
};

export default CommentComposer;
