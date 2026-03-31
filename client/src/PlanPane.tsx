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
  createEffect,
  on,
  onCleanup,
} from "solid-js";
import { marked } from "marked";
import { toast } from "solid-sonner";
import type { PlanContent } from "kolu-common";

marked.setOptions({ breaks: true, gfm: true });

/** Build a map from raw-text snippets to their source line numbers.
 *  Used to stamp rendered HTML elements with data-line attributes. */
function buildLineMap(content: string): Map<string, number> {
  const map = new Map<string, number>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim();
    // Only map non-empty, non-markup lines (skip blank lines, pure markdown syntax)
    if (text && !map.has(text)) {
      map.set(text, i + 1); // 1-based
    }
  }
  return map;
}

/** Render markdown and style feedback blockquotes as inline callouts.
 *  Also stamps block elements with data-line for accurate feedback placement. */
function renderPlanMarkdown(content: string): string {
  const lineMap = buildLineMap(content);
  let html = marked.parse(content) as string;

  // Stamp headings with data-line by matching heading text back to source lines
  html = html.replace(/<(h[1-6])>(.*?)<\/\1>/g, (_m, tag, text) => {
    const clean = text.replace(/<[^>]+>/g, "").trim();
    const line =
      lineMap.get(clean) ??
      lineMap.get(`# ${clean}`) ??
      lineMap.get(`## ${clean}`) ??
      lineMap.get(`### ${clean}`);
    return `<${tag}${line ? ` data-line="${line}"` : ""}>${text}</${tag}>`;
  });

  // Stamp paragraphs with data-line
  html = html.replace(/<p>([\s\S]*?)<\/p>/g, (_m, inner) => {
    // Use first line of paragraph text to find source line
    const firstLine = inner
      .replace(/<[^>]+>/g, "")
      .trim()
      .split("\n")[0]
      ?.trim();
    if (firstLine) {
      const line = lineMap.get(firstLine);
      if (line) return `<p data-line="${line}">${inner}</p>`;
    }
    return `<p>${inner}</p>`;
  });

  // Stamp list items with data-line
  html = html.replace(/<li>([\s\S]*?)<\/li>/g, (_m, inner) => {
    const text = inner
      .replace(/<[^>]+>/g, "")
      .trim()
      .split("\n")[0]
      ?.trim();
    if (text) {
      // List items in markdown have prefix (- or *), try without
      const line =
        lineMap.get(text) ??
        lineMap.get(`- ${text}`) ??
        lineMap.get(`* ${text}`);
      if (line) return `<li data-line="${line}">${inner}</li>`;
    }
    return `<li>${inner}</li>`;
  });

  // Build a queue of feedback source line numbers (1-based) for matching
  const feedbackLineNums: number[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("> [FEEDBACK]:")) feedbackLineNums.push(i + 1);
  }
  let feedbackIdx = 0;

  // Restyle feedback blockquotes as callouts with remove/edit actions
  html = html.replace(
    /<blockquote>\s*<p>\[FEEDBACK\]:\s*([\s\S]*?)<\/p>\s*<\/blockquote>/g,
    (_match, text: string) => {
      const srcLine = feedbackLineNums[feedbackIdx++] ?? 0;
      const actions =
        `<span class="plan-feedback-actions">` +
        `<button data-feedback-edit="${srcLine}" class="plan-feedback-btn" title="Edit">✎</button>` +
        `<button data-feedback-remove="${srcLine}" class="plan-feedback-btn" title="Remove">×</button>` +
        `</span>`;
      const reMatch = text.match(/^Re: «(.+?)»\s*[—–-]\s*([\s\S]*)$/);
      if (reMatch) {
        return `<div class="plan-feedback" data-feedback-line="${srcLine}"><span class="plan-feedback-ref">Re: «${reMatch[1]}»</span> ${reMatch[2]!.trim()}${actions}</div>`;
      }
      return `<div class="plan-feedback" data-feedback-line="${srcLine}">${text}${actions}</div>`;
    },
  );

  return html;
}

/** Walk up the DOM from a node to find the nearest element with a data-line attribute. */
function findLineFromNode(node: Node): number | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.dataset.line) {
      return parseInt(el.dataset.line, 10);
    }
    el = el.parentElement;
  }
  return null;
}

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

  /** Rendered HTML from markdown with feedback rendered inline. */
  const renderedHtml = createMemo(() => {
    if (!props.content) return "";
    return renderPlanMarkdown(props.content.content);
  });

  /** Track previous content to highlight changes when Claude updates the plan. */
  let prevLines: string[] = [];
  createEffect(
    on(
      () => props.content?.content,
      (raw) => {
        if (!raw || !contentRef) return;
        const newLines = raw.split("\n");
        if (prevLines.length === 0) {
          prevLines = newLines;
          return;
        }

        // Find which source lines changed or were added
        const changedLines = new Set<number>();
        const maxLen = Math.max(prevLines.length, newLines.length);
        for (let i = 0; i < maxLen; i++) {
          if (prevLines[i] !== newLines[i]) changedLines.add(i + 1); // 1-based
        }
        prevLines = newLines;

        if (changedLines.size === 0) return;

        // After DOM update, highlight elements whose data-line is in the changed set
        requestAnimationFrame(() => {
          if (!contentRef) return;
          const els = contentRef.querySelectorAll("[data-line]");
          for (const el of els) {
            const line = parseInt((el as HTMLElement).dataset.line ?? "0", 10);
            if (changedLines.has(line)) {
              el.classList.add("plan-changed");
              // Remove after animation completes
              setTimeout(() => el.classList.remove("plan-changed"), 2000);
            }
          }
        });
      },
      { defer: true },
    ),
  );

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

    // Find the source line from the nearest data-line-annotated element.
    // Fall back to end-of-file if no annotated ancestor (e.g. table cells).
    const sourceLine =
      findLineFromNode(range.startContainer) ??
      findLineFromNode(range.endContainer) ??
      (props.content ? props.content.content.split("\n").length : 1);

    const rect = range.getBoundingClientRect();
    const top = Math.min(rect.bottom + 8, window.innerHeight - 200);
    const left = Math.min(rect.left, window.innerWidth - 300);

    setSelection({ text, sourceLine, top, left });
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

  /** Handle clicks on feedback remove/edit buttons (event delegation on innerHTML). */
  function handleContentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    // Remove feedback
    const removeLine = target.dataset.feedbackRemove;
    if (removeLine && props.content) {
      props.onRemoveFeedback(props.content.path, parseInt(removeLine, 10));
      return;
    }

    // Edit feedback — remove the old one and open selection popover to re-enter
    const editLine = target.dataset.feedbackEdit;
    if (editLine && props.content) {
      // Find the feedback text from the parent .plan-feedback div
      const feedbackDiv = target.closest(".plan-feedback");
      const refEl = feedbackDiv?.querySelector(".plan-feedback-ref");
      const refText = refEl?.textContent ?? "";
      // Remove old feedback, then user can re-add with text selection
      props.onRemoveFeedback(props.content.path, parseInt(editLine, 10));
      // Show a toast hinting to re-select and comment
      toast(`Feedback removed: ${refText}. Select text to re-add.`, {
        duration: 4_000,
      });
      return;
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

      {/* Content — overflow-x-hidden prevents wide tables from expanding the pane */}
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
            {/* Rendered markdown with inline feedback — innerHTML safe: local plan files */}
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
