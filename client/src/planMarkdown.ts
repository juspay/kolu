/**
 * Plan markdown rendering — converts raw plan markdown to annotated HTML.
 *
 * Structured as a pipeline of independent transforms, each addressing one concern:
 *   1. Parse markdown to HTML (marked)
 *   2. Stamp block elements with source line numbers (data-line)
 *   3. Restyle feedback blockquotes as interactive callouts
 *
 * Each transform operates on the HTML string independently. No transform
 * depends on the output shape of another — they can be reordered or removed.
 */

import { marked } from "marked";

marked.setOptions({ breaks: true, gfm: true });

// --- Line mapping ---

/** Map from raw-text snippets to ALL their source line numbers (1-based).
 *  Stores every occurrence, not just the first — avoids misannotating
 *  duplicate text (e.g. repeated table cell values). */
type LineMap = Map<string, number[]>;

function buildLineMap(content: string): LineMap {
  const map: LineMap = new Map();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!.trim();
    if (!text) continue;
    const existing = map.get(text);
    if (existing) existing.push(i + 1);
    else map.set(text, [i + 1]);
  }
  return map;
}

/** Get the next unused line number for a text snippet.
 *  Tracks consumption via an index map so repeated text gets sequential lines. */
function createLineResolver(lineMap: LineMap) {
  const consumed = new Map<string, number>();
  return (text: string, ...prefixes: string[]): number | null => {
    // Try the text itself, then with each prefix
    const candidates = [text, ...prefixes.map((p) => `${p} ${text}`)];
    for (const candidate of candidates) {
      const lines = lineMap.get(candidate);
      if (!lines) continue;
      const idx = consumed.get(candidate) ?? 0;
      if (idx < lines.length) {
        consumed.set(candidate, idx + 1);
        return lines[idx]!;
      }
    }
    return null;
  };
}

// --- Transform: stamp elements with data-line ---

/** Stamp headings, paragraphs, and list items with data-line attributes
 *  so text selections can map back to source line numbers. */
function stampLineNumbers(html: string, lineMap: LineMap): string {
  const resolve = createLineResolver(lineMap);

  // Headings
  html = html.replace(/<(h[1-6])>(.*?)<\/\1>/g, (_m, tag, text) => {
    const clean = text.replace(/<[^>]+>/g, "").trim();
    const line = resolve(clean, "#", "##", "###", "####");
    return `<${tag}${line ? ` data-line="${line}"` : ""}>${text}</${tag}>`;
  });

  // Paragraphs — use first line of text content
  html = html.replace(/<p>([\s\S]*?)<\/p>/g, (_m, inner) => {
    const firstLine = inner
      .replace(/<[^>]+>/g, "")
      .trim()
      .split("\n")[0]
      ?.trim();
    if (firstLine) {
      const line = resolve(firstLine);
      if (line) return `<p data-line="${line}">${inner}</p>`;
    }
    return `<p>${inner}</p>`;
  });

  // List items
  html = html.replace(/<li>([\s\S]*?)<\/li>/g, (_m, inner) => {
    const text = inner
      .replace(/<[^>]+>/g, "")
      .trim()
      .split("\n")[0]
      ?.trim();
    if (text) {
      const line = resolve(text, "-", "*");
      if (line) return `<li data-line="${line}">${inner}</li>`;
    }
    return `<li>${inner}</li>`;
  });

  return html;
}

// --- Transform: restyle feedback blockquotes ---

/** Replace `> [FEEDBACK]: ...` blockquotes with styled callout divs
 *  that include edit/remove action buttons and source line references. */
function restyleFeedback(html: string, content: string): string {
  // Build a queue of feedback source line numbers for sequential matching
  const feedbackLineNums: number[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.startsWith("> [FEEDBACK]:")) feedbackLineNums.push(i + 1);
  }
  let idx = 0;

  return html.replace(
    /<blockquote>\s*<p>\[FEEDBACK\]:\s*([\s\S]*?)<\/p>\s*<\/blockquote>/g,
    (_match, text: string) => {
      const srcLine = feedbackLineNums[idx++] ?? 0;
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
}

// --- Public API ---

/** Render plan markdown to annotated HTML with inline feedback callouts. */
export function renderPlanMarkdown(content: string): string {
  const lineMap = buildLineMap(content);
  let html = marked.parse(content) as string;
  html = stampLineNumbers(html, lineMap);
  html = restyleFeedback(html, content);
  return html;
}

/** Walk up the DOM from a node to find the nearest element with a data-line attribute. */
export function findLineFromNode(node: Node): number | null {
  let el: Node | null = node;
  while (el) {
    if (el instanceof HTMLElement && el.dataset.line) {
      return parseInt(el.dataset.line, 10);
    }
    el = el.parentElement;
  }
  return null;
}
