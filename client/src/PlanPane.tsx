/** PlanPane — renders a plan file as structured sections with inline commenting. */

import { type Component, Show, For, createSignal, createMemo } from "solid-js";
import type { PlanContent } from "kolu-common";

/** A parsed section of a plan file (heading + content until next heading). */
interface PlanSection {
  heading: string;
  level: number;
  /** Line number of the heading (1-based). */
  lineStart: number;
  /** Line number of the last content line before the next heading (1-based). */
  lineEnd: number;
  /** Raw content lines below the heading (excludes the heading itself). */
  content: string;
  /** Existing feedback blocks in this section. */
  feedbacks: string[];
}

/** Parse plan markdown into sections by headings. */
function parseSections(content: string): PlanSection[] {
  const lines = content.split("\n");
  const sections: PlanSection[] = [];
  let current: PlanSection | null = null;
  const contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      // Flush previous section
      if (current) {
        current.lineEnd = i; // Previous line (0-based → 1-based handled below)
        current.content = contentLines.join("\n").trim();
        current.feedbacks = extractFeedbacks(contentLines);
        sections.push(current);
        contentLines.length = 0;
      }

      current = {
        heading: headingMatch[2]!,
        level: headingMatch[1]!.length,
        lineStart: i + 1, // 1-based
        lineEnd: i + 1,
        content: "",
        feedbacks: [],
      };
    } else if (current) {
      contentLines.push(line);
    }
  }

  // Flush last section
  if (current) {
    current.lineEnd = lines.length;
    current.content = contentLines.join("\n").trim();
    current.feedbacks = extractFeedbacks(contentLines);
    sections.push(current);
  }

  // If no headings found, treat entire content as one section
  if (sections.length === 0 && content.trim()) {
    sections.push({
      heading: "Plan",
      level: 1,
      lineStart: 1,
      lineEnd: lines.length,
      content: content.trim(),
      feedbacks: [],
    });
  }

  return sections;
}

/** Extract existing feedback blockquotes from content lines. */
function extractFeedbacks(lines: string[]): string[] {
  const feedbacks: string[] = [];
  let current: string[] = [];
  let inFeedback = false;

  for (const line of lines) {
    if (line.startsWith("> [FEEDBACK]:")) {
      inFeedback = true;
      current.push(line.replace(/^> \[FEEDBACK\]:\s*/, ""));
    } else if (inFeedback && line.startsWith("> ")) {
      current.push(line.replace(/^> /, ""));
    } else {
      if (inFeedback && current.length > 0) {
        feedbacks.push(current.join("\n"));
        current = [];
      }
      inFeedback = false;
    }
  }
  if (current.length > 0) feedbacks.push(current.join("\n"));

  return feedbacks;
}

/** Strip feedback blockquotes from content for display.
 *  Only removes lines that are part of a feedback block (starting with `> [FEEDBACK]:`)
 *  and their continuation lines. Normal blockquotes are preserved. */
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

const SectionBlock: Component<{
  section: PlanSection;
  onAddFeedback: (afterLine: number, text: string) => void;
}> = (props) => {
  const [commenting, setCommenting] = createSignal(false);
  const [feedbackText, setFeedbackText] = createSignal("");

  function handleSubmit() {
    const text = feedbackText().trim();
    if (!text) return;
    props.onAddFeedback(props.section.lineStart, text);
    setFeedbackText("");
    setCommenting(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      setCommenting(false);
      setFeedbackText("");
    }
  }

  const headingTag = () => {
    const l = props.section.level;
    return l <= 2 ? "text-base font-semibold" : "text-sm font-medium";
  };

  const displayContent = createMemo(() => stripFeedback(props.section.content));

  return (
    <div
      class="group border-b border-edge last:border-b-0"
      data-testid="plan-section"
    >
      {/* Heading + add-feedback button */}
      <div class="flex items-center gap-2 px-3 py-2 bg-surface-1">
        <span class={`flex-1 text-fg ${headingTag()}`}>
          {props.section.heading}
        </span>
        <button
          class="opacity-0 group-hover:opacity-100 text-xs text-fg-3 hover:text-accent transition-opacity px-1.5 py-0.5 rounded hover:bg-surface-2"
          onClick={() => setCommenting(true)}
          title="Add feedback to this section"
          data-testid="add-feedback-btn"
        >
          + Feedback
        </button>
      </div>

      {/* Content */}
      <Show when={displayContent()}>
        <pre class="px-3 py-2 text-sm text-fg-2 whitespace-pre-wrap font-sans leading-relaxed">
          {displayContent()}
        </pre>
      </Show>

      {/* Existing feedbacks */}
      <For each={props.section.feedbacks}>
        {(fb) => (
          <div class="mx-3 my-1 px-3 py-1.5 border-l-2 border-accent/60 bg-accent/5 text-sm text-accent-bright rounded-r">
            {fb}
          </div>
        )}
      </For>

      {/* Feedback input */}
      <Show when={commenting()}>
        <div class="px-3 py-2 bg-surface-2/50">
          <textarea
            class="w-full bg-surface-0 border border-edge rounded px-2 py-1.5 text-sm text-fg placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            placeholder="Add feedback for this section..."
            rows={3}
            value={feedbackText()}
            onInput={(e) => setFeedbackText(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            ref={(el) => requestAnimationFrame(() => el.focus())}
            data-testid="feedback-input"
          />
          <div class="flex gap-2 mt-1.5 justify-end">
            <button
              class="text-xs text-fg-3 hover:text-fg px-2 py-1 rounded hover:bg-surface-2"
              onClick={() => {
                setCommenting(false);
                setFeedbackText("");
              }}
            >
              Cancel
            </button>
            <button
              class="text-xs text-surface-0 bg-accent hover:bg-accent-bright px-3 py-1 rounded font-medium disabled:opacity-50"
              disabled={!feedbackText().trim()}
              onClick={handleSubmit}
              data-testid="submit-feedback-btn"
            >
              Add
            </button>
          </div>
          <p class="text-xs text-fg-3 mt-1">
            {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+Enter to submit
          </p>
        </div>
      </Show>
    </div>
  );
};

const PlanPane: Component<{
  content: PlanContent | undefined;
  loading: boolean;
  planName: string;
  onAddFeedback: (path: string, afterLine: number, text: string) => void;
}> = (props) => {
  const sections = createMemo(() => {
    if (!props.content) return [];
    return parseSections(props.content.content);
  });

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
            when={sections().length > 0}
            fallback={
              <div class="flex items-center justify-center h-full text-fg-3 text-sm">
                Empty plan
              </div>
            }
          >
            <For each={sections()}>
              {(section) => (
                <SectionBlock
                  section={section}
                  onAddFeedback={(afterLine, text) =>
                    props.content &&
                    props.onAddFeedback(props.content.path, afterLine, text)
                  }
                />
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default PlanPane;
