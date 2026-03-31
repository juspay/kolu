/** PlanPane — renders a plan file as full markdown with text-selection commenting.
 *
 *  Select any text in the rendered plan to leave inline feedback. Feedback is
 *  written back to the plan file as blockquotes referencing the selected text,
 *  and rendered inline within the markdown (not in a separate section).
 *
 *  Composed from independent modules:
 *  - planMarkdown.ts — markdown rendering + line annotation + feedback restyling
 *  - usePlanChangeHighlight.ts — change detection + DOM highlight animation */

import {
  type Component,
  Show,
  createSignal,
  createMemo,
  onCleanup,
} from "solid-js";
import { toast } from "solid-sonner";
import type { PlanContent } from "kolu-common";
import { renderPlanMarkdown, findLineFromNode } from "./planMarkdown";
import { usePlanChangeHighlight } from "./usePlanChangeHighlight";

/** Selection popover state. */
interface SelectionState {
  text: string;
  /** Source line number from the markdown file (via data-line attribute). */
  sourceLine: number;
  top: number;
  left: number;
}

/** Floating popover that appears on text selection. */
const SelectionPopover: Component<{
  selection: SelectionState;
  onSubmit: (selectedText: string, sourceLine: number, comment: string) => void;
  onDismiss: () => void;
}> = (props) => {
  const [comment, setComment] = createSignal("");

  function handleSubmit() {
    const text = comment().trim();
    if (!text) return;
    props.onSubmit(props.selection.text, props.selection.sourceLine, text);
    setComment("");
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      props.onDismiss();
    }
  }

  return (
    <div
      class="fixed z-50 bg-surface-1 border border-edge rounded-lg shadow-xl p-3 w-72"
      style={{
        top: `${props.selection.top}px`,
        left: `${props.selection.left}px`,
      }}
      data-testid="selection-popover"
    >
      <div
        class="text-xs text-fg-3 mb-1.5 truncate"
        title={props.selection.text}
      >
        Re: «{props.selection.text.slice(0, 60)}
        {props.selection.text.length > 60 ? "…" : ""}»
      </div>
      <textarea
        class="w-full bg-surface-0 border border-edge rounded px-2 py-1.5 text-xs text-fg placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
        placeholder="Add your feedback..."
        rows={2}
        value={comment()}
        onInput={(e) => setComment(e.currentTarget.value)}
        onKeyDown={handleKeyDown}
        ref={(el) => requestAnimationFrame(() => el.focus())}
        data-testid="feedback-input"
      />
      <div class="flex gap-2 mt-1.5 justify-between items-center">
        <span class="text-xs text-fg-3">
          {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter
        </span>
        <div class="flex gap-2">
          <button
            class="text-xs text-fg-3 hover:text-fg px-2 py-1 rounded hover:bg-surface-2"
            onClick={props.onDismiss}
          >
            Cancel
          </button>
          <button
            class="text-xs text-surface-0 bg-accent hover:bg-accent-bright px-3 py-1 rounded font-medium disabled:opacity-50"
            disabled={!comment().trim()}
            onClick={handleSubmit}
            data-testid="submit-feedback-btn"
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
};

const PlanPane: Component<{
  content: PlanContent | undefined;
  loading: boolean;
  planName: string;
  planPath: string | null;
  onAddFeedback: (path: string, afterLine: number, text: string) => void;
  onRemoveFeedback: (path: string, feedbackLine: number) => void;
  /** Send text + Enter to the active terminal (where Claude is running). */
  onSendToTerminal: (text: string) => void;
}> = (props) => {
  const [selection, setSelection] = createSignal<SelectionState | null>(null);
  let contentRef: HTMLDivElement | undefined;

  const renderedHtml = createMemo(() => {
    if (!props.content) return "";
    return renderPlanMarkdown(props.content.content);
  });

  // Change highlighting — separate concern, own module
  usePlanChangeHighlight(
    () => props.content?.content,
    () => contentRef,
  );

  const feedbackCount = createMemo(() => {
    if (!props.content) return 0;
    return (props.content.content.match(/^> \[FEEDBACK\]:/gm) ?? []).length;
  });

  const hasFeedback = () => feedbackCount() > 0;

  // --- Text selection → comment popover ---

  function handleMouseUp() {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim() || !sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    if (!contentRef?.contains(range.commonAncestorContainer)) return;

    const text = sel.toString().trim();
    if (text.length < 3) return;

    const sourceLine =
      findLineFromNode(range.startContainer) ??
      findLineFromNode(range.endContainer) ??
      (props.content ? props.content.content.split("\n").length : 1);

    const rect = range.getBoundingClientRect();
    setSelection({
      text,
      sourceLine,
      top: Math.min(rect.bottom + 8, window.innerHeight - 200),
      left: Math.min(rect.left, window.innerWidth - 300),
    });
  }

  function handleClickOutside(e: MouseEvent) {
    const popover = document.querySelector('[data-testid="selection-popover"]');
    if (popover && !popover.contains(e.target as Node)) setSelection(null);
  }

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mousedown", handleClickOutside);
  onCleanup(() => {
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mousedown", handleClickOutside);
  });

  // --- Feedback CRUD via event delegation on innerHTML ---

  function handleContentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    const removeLine = target.dataset.feedbackRemove;
    if (removeLine && props.content) {
      props.onRemoveFeedback(props.content.path, parseInt(removeLine, 10));
      return;
    }

    const editLine = target.dataset.feedbackEdit;
    if (editLine && props.content) {
      const refText =
        target.closest(".plan-feedback")?.querySelector(".plan-feedback-ref")
          ?.textContent ?? "";
      props.onRemoveFeedback(props.content.path, parseInt(editLine, 10));
      toast(`Feedback removed: ${refText}. Select text to re-add.`, {
        duration: 4_000,
      });
    }
  }

  function handleFeedbackSubmit(
    selectedText: string,
    sourceLine: number,
    comment: string,
  ) {
    if (!props.content) return;
    const feedbackText = `Re: «${selectedText.replace(/\n/g, " ")}» — ${comment}`;
    props.onAddFeedback(props.content.path, sourceLine, feedbackText);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div
      class="flex flex-col h-full w-full overflow-hidden bg-surface-0"
      data-testid="plan-pane"
    >
      {/* Header — plan name, file path, feedback count */}
      <div class="px-3 py-1.5 bg-surface-1 border-b border-edge shrink-0">
        <div class="flex items-center gap-2">
          <span class="text-xs font-medium text-fg truncate flex-1">
            {props.planName}
          </span>
          <Show when={feedbackCount() > 0}>
            <span class="text-[10px] font-medium text-accent bg-accent/15 px-1.5 py-0.5 rounded-full shrink-0">
              {feedbackCount()} comment{feedbackCount() !== 1 ? "s" : ""}
            </span>
          </Show>
        </div>
        <Show when={props.planPath}>
          <span
            class="text-[10px] text-fg-3 truncate block"
            title={props.planPath!}
          >
            {props.planPath}
          </span>
        </Show>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-y-auto overflow-x-hidden">
        <Show
          when={!props.loading}
          fallback={
            <div class="flex items-center justify-center h-full text-fg-3 text-xs">
              Loading plan...
            </div>
          }
        >
          <Show
            when={renderedHtml()}
            fallback={
              <div class="flex items-center justify-center h-full text-fg-3 text-xs">
                Empty plan
              </div>
            }
          >
            <div
              ref={contentRef}
              class="px-3 py-2 plan-markdown"
              data-testid="plan-content"
              innerHTML={renderedHtml()}
              onClick={handleContentClick}
            />
          </Show>
        </Show>
      </div>

      {/* Action bar */}
      <div class="px-3 py-2 bg-surface-1 border-t border-edge shrink-0 flex gap-2 justify-end">
        <button
          class="text-xs px-3 py-1.5 rounded font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          classList={{
            "bg-accent/20 text-accent hover:bg-accent/30": hasFeedback(),
          }}
          disabled={!hasFeedback()}
          onClick={() =>
            props.onSendToTerminal(
              "I added inline feedback to the plan file. Re-read it and revise accordingly.",
            )
          }
          title="Tell Claude to re-read the plan and incorporate your feedback"
          data-testid="plan-review-btn"
        >
          Review
        </button>
        <button
          class="text-xs text-surface-0 bg-accent hover:bg-accent-bright px-3 py-1.5 rounded font-medium"
          onClick={() => props.onSendToTerminal("Proceed with the plan")}
          title="Tell Claude to proceed with the plan"
          data-testid="plan-proceed-btn"
        >
          Proceed
        </button>
      </div>

      {/* Selection popover */}
      <Show when={selection()}>
        {(sel) => (
          <SelectionPopover
            selection={sel()}
            onSubmit={handleFeedbackSubmit}
            onDismiss={() => setSelection(null)}
          />
        )}
      </Show>
    </div>
  );
};

export default PlanPane;
