/** PlanPane — renders a plan file as full markdown with text-selection commenting.
 *
 *  Select any text in the rendered plan to leave inline feedback. Feedback is
 *  written back to the plan file as blockquotes referencing the selected text. */

import {
  type Component,
  Show,
  For,
  createSignal,
  createMemo,
  onCleanup,
} from "solid-js";
import { marked } from "marked";
import type { PlanContent } from "kolu-common";

// Configure marked for safe rendering (plan files are trusted local content)
marked.setOptions({ breaks: true, gfm: true });

/** Strip feedback blockquotes from markdown content before rendering.
 *  Removes lines starting with `> [FEEDBACK]:` and their continuation `> ` lines.
 *  Normal blockquotes are preserved. */
function stripFeedback(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let inFeedback = false;

  for (const line of lines) {
    if (line.startsWith("> [FEEDBACK]:")) {
      inFeedback = true;
    } else if (inFeedback && line.startsWith("> ")) {
      // Continuation of feedback block — skip
    } else {
      inFeedback = false;
      result.push(line);
    }
  }

  return result
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Extract existing feedback entries from the raw plan content. */
interface FeedbackEntry {
  selectedText: string | null;
  comment: string;
}

function extractFeedbacks(content: string): FeedbackEntry[] {
  const lines = content.split("\n");
  const feedbacks: FeedbackEntry[] = [];
  let currentLines: string[] = [];
  let inFeedback = false;

  for (const line of lines) {
    if (line.startsWith("> [FEEDBACK]:")) {
      inFeedback = true;
      currentLines.push(line.replace(/^> \[FEEDBACK\]:\s*/, ""));
    } else if (inFeedback && line.startsWith("> ")) {
      currentLines.push(line.replace(/^> /, ""));
    } else {
      if (inFeedback && currentLines.length > 0) {
        const text = currentLines.join("\n");
        // Parse "Re: «selected text» — comment" format
        const reMatch = text.match(/^Re: «(.+?)»\s*[—–-]\s*([\s\S]*)$/);
        if (reMatch) {
          feedbacks.push({
            selectedText: reMatch[1]!,
            comment: reMatch[2]!.trim(),
          });
        } else {
          feedbacks.push({ selectedText: null, comment: text });
        }
        currentLines = [];
      }
      inFeedback = false;
    }
  }
  if (currentLines.length > 0) {
    const text = currentLines.join("\n");
    const reMatch = text.match(/^Re: «(.+?)»\s*[—–-]\s*([\s\S]*)$/);
    if (reMatch) {
      feedbacks.push({
        selectedText: reMatch[1]!,
        comment: reMatch[2]!.trim(),
      });
    } else {
      feedbacks.push({ selectedText: null, comment: text });
    }
  }

  return feedbacks;
}

/** Find the line number in the original content where the selected text appears. */
function findLineForText(content: string, selectedText: string): number {
  const lines = content.split("\n");
  // Search for a line containing the start of the selected text
  const searchText = selectedText.split("\n")[0]!.trim();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(searchText)) {
      return i + 1; // 1-based
    }
  }
  // Fallback: insert after the last line
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
        class="w-full bg-surface-0 border border-edge rounded px-2 py-1.5 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
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
  onAddFeedback: (path: string, afterLine: number, text: string) => void;
}> = (props) => {
  const [selection, setSelection] = createSignal<SelectionState | null>(null);
  let contentRef: HTMLDivElement | undefined;

  /** Rendered HTML from markdown with feedback blockquotes stripped. */
  const renderedHtml = createMemo(() => {
    if (!props.content) return "";
    const md = stripFeedback(props.content.content);
    return marked.parse(md) as string;
  });

  /** Existing feedback entries from the raw content. */
  const feedbacks = createMemo(() => {
    if (!props.content) return [];
    return extractFeedbacks(props.content.content);
  });

  /** Handle text selection — show popover near the selection. */
  function handleMouseUp() {
    const sel = window.getSelection();
    if (!sel || !sel.toString().trim() || !sel.rangeCount) {
      return;
    }

    // Only handle selections within the content area
    const range = sel.getRangeAt(0);
    if (!contentRef?.contains(range.commonAncestorContainer)) {
      return;
    }

    const text = sel.toString().trim();
    if (text.length < 3) return; // Ignore tiny selections

    const rect = range.getBoundingClientRect();
    // Position popover below the selection, clamped to viewport
    const top = Math.min(rect.bottom + 8, window.innerHeight - 200);
    const left = Math.min(rect.left, window.innerWidth - 300);

    setSelection({ text, top, left });
  }

  /** Dismiss popover on click outside or Escape. */
  function handleClickOutside(e: MouseEvent) {
    const popover = document.querySelector('[data-testid="selection-popover"]');
    if (popover && !popover.contains(e.target as Node)) {
      setSelection(null);
    }
  }

  // Global listeners for selection and click-outside
  document.addEventListener("mouseup", handleMouseUp);
  document.addEventListener("mousedown", handleClickOutside);
  onCleanup(() => {
    document.removeEventListener("mouseup", handleMouseUp);
    document.removeEventListener("mousedown", handleClickOutside);
  });

  function handleFeedbackSubmit(selectedText: string, comment: string) {
    if (!props.content) return;
    const line = findLineForText(props.content.content, selectedText);
    // Format: Re: «selected text» — comment
    const feedbackText = `Re: «${selectedText.replace(/\n/g, " ")}» — ${comment}`;
    props.onAddFeedback(props.content.path, line, feedbackText);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div class="flex flex-col h-full bg-surface-0" data-testid="plan-pane">
      {/* Header */}
      <div class="px-3 py-2 bg-surface-1 border-b border-edge shrink-0">
        <span
          class="text-sm font-medium text-fg truncate block"
          title={props.planName}
        >
          {props.planName}
        </span>
      </div>

      {/* Content */}
      <div class="flex-1 overflow-y-auto">
        <Show
          when={!props.loading}
          fallback={
            <div class="flex items-center justify-center h-full text-fg-3 text-sm">
              Loading plan...
            </div>
          }
        >
          <Show
            when={renderedHtml()}
            fallback={
              <div class="flex items-center justify-center h-full text-fg-3 text-sm">
                Empty plan
              </div>
            }
          >
            {/* Rendered markdown — innerHTML is safe here: content is from local plan files */}
            <div
              ref={contentRef}
              class="px-4 py-3 plan-markdown"
              data-testid="plan-content"
              innerHTML={renderedHtml()}
            />

            {/* Existing feedback entries */}
            <Show when={feedbacks().length > 0}>
              <div class="border-t border-edge px-4 py-3">
                <div class="text-xs font-medium text-fg-3 uppercase tracking-wider mb-2">
                  Feedback
                </div>
                <For each={feedbacks()}>
                  {(fb) => (
                    <div
                      class="mb-2 px-3 py-2 border-l-2 border-accent/60 bg-accent/5 rounded-r text-sm"
                      data-testid="feedback-entry"
                    >
                      <Show when={fb.selectedText}>
                        <div class="text-xs text-fg-3 mb-1 italic">
                          Re: «{fb.selectedText}»
                        </div>
                      </Show>
                      <div class="text-accent-bright">{fb.comment}</div>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Show>
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
