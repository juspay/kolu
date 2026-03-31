/** PlanPane — renders a plan file as full markdown with text-selection commenting.
 *
 *  Select any text in the rendered plan to leave inline feedback. Feedback is
 *  written back to the plan file as blockquotes referencing the selected text,
 *  and rendered inline within the markdown (not in a separate section). */

import {
  type Component,
  Show,
  createSignal,
  createMemo,
  onCleanup,
} from "solid-js";
import { marked } from "marked";
import type { PlanContent } from "kolu-common";

// Configure marked for safe rendering (plan files are trusted local content)
marked.setOptions({ breaks: true, gfm: true });

/** Render markdown content including feedback blockquotes inline.
 *  Feedback lines `> [FEEDBACK]: ...` are rendered as styled callouts
 *  by converting them to HTML before marked processes them. */
function renderPlanMarkdown(content: string): string {
  // Convert feedback blockquotes to styled HTML before markdown parsing.
  // This renders them inline within the document flow.
  const lines = content.split("\n");
  const result: string[] = [];
  let feedbackLines: string[] = [];
  let inFeedback = false;

  function flushFeedback() {
    if (feedbackLines.length === 0) return;
    const text = feedbackLines.join(" ");
    // Parse "Re: «selected text» — comment" format
    const reMatch = text.match(/^Re: «(.+?)»\s*[—–-]\s*([\s\S]*)$/);
    if (reMatch) {
      result.push(
        `<div class="plan-feedback"><span class="plan-feedback-ref">Re: «${escapeHtml(reMatch[1]!)}»</span> ${escapeHtml(reMatch[2]!.trim())}</div>`,
      );
    } else {
      result.push(`<div class="plan-feedback">${escapeHtml(text)}</div>`);
    }
    feedbackLines = [];
  }

  for (const line of lines) {
    if (line.startsWith("> [FEEDBACK]:")) {
      inFeedback = true;
      feedbackLines.push(line.replace(/^> \[FEEDBACK\]:\s*/, ""));
    } else if (inFeedback && line.startsWith("> ")) {
      feedbackLines.push(line.replace(/^> /, ""));
    } else {
      if (inFeedback) {
        flushFeedback();
        inFeedback = false;
      }
      result.push(line);
    }
  }
  flushFeedback();

  return marked.parse(result.join("\n")) as string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Find the line number in the original content where the selected text appears. */
function findLineForText(content: string, selectedText: string): number {
  const lines = content.split("\n");
  const searchText = selectedText.split("\n")[0]!.trim();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(searchText)) {
      return i + 1;
    }
  }
  return lines.length;
}

/** Selection popover state. */
interface SelectionState {
  text: string;
  top: number;
  left: number;
}

/** Floating popover that appears on text selection. */
const SelectionPopover: Component<{
  selection: SelectionState;
  onSubmit: (selectedText: string, comment: string) => void;
  onDismiss: () => void;
}> = (props) => {
  const [comment, setComment] = createSignal("");

  function handleSubmit() {
    const text = comment().trim();
    if (!text) return;
    props.onSubmit(props.selection.text, text);
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
  /** Send text + Enter to the active terminal (where Claude is running). */
  onSendToTerminal: (text: string) => void;
}> = (props) => {
  const [selection, setSelection] = createSignal<SelectionState | null>(null);
  let contentRef: HTMLDivElement | undefined;

  /** Rendered HTML from markdown with feedback rendered inline. */
  const renderedHtml = createMemo(() => {
    if (!props.content) return "";
    return renderPlanMarkdown(props.content.content);
  });

  /** Whether the plan file contains any feedback blockquotes. */
  const hasFeedback = createMemo(
    () => !!props.content?.content.includes("> [FEEDBACK]:"),
  );

  /** Handle text selection — show popover near the selection. */
  function handleMouseUp() {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim() || !sel.rangeCount) {
      return;
    }

    const range = sel.getRangeAt(0);
    if (!contentRef?.contains(range.commonAncestorContainer)) {
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 3) return;

    const rect = range.getBoundingClientRect();
    const top = Math.min(rect.bottom + 8, window.innerHeight - 200);
    const left = Math.min(rect.left, window.innerWidth - 300);

    setSelection({ text, top, left });
  }

  function handleClickOutside(e: MouseEvent) {
    const popover = document.querySelector('[data-testid="selection-popover"]');
    if (popover && !popover.contains(e.target as Node)) {
      setSelection(null);
    }
  }

  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mousedown", handleClickOutside);
  onCleanup(() => {
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mousedown", handleClickOutside);
  });

  function handleFeedbackSubmit(selectedText: string, comment: string) {
    if (!props.content) return;
    const line = findLineForText(props.content.content, selectedText);
    const feedbackText = `Re: «${selectedText.replace(/\n/g, " ")}» — ${comment}`;
    props.onAddFeedback(props.content.path, line, feedbackText);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div class="flex flex-col h-full bg-surface-0" data-testid="plan-pane">
      {/* Header — plan name + file path */}
      <div class="px-3 py-1.5 bg-surface-1 border-b border-edge shrink-0">
        <span class="text-xs font-medium text-fg truncate block">
          {props.planName}
        </span>
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
      <div class="flex-1 overflow-y-auto">
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
            {/* Rendered markdown with inline feedback — innerHTML safe: local plan files */}
            <div
              ref={contentRef}
              class="px-3 py-2 plan-markdown"
              data-testid="plan-content"
              innerHTML={renderedHtml()}
            />
          </Show>
        </Show>
      </div>

      {/* Action bar — Review (sends feedback notification) and Proceed */}
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
