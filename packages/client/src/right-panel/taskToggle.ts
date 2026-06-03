// Import from the DOM-free render subpath (not the package barrel, which pulls
// in the Solid `Markdown` component and `solid-js/web`) so the renderer's
// front-matter regex stays single-sourced without dragging a browser-only
// dependency into this Node-testable helper.
import { stripFrontMatter } from "@kolu/solid-markdown/render";

/** Flip the Nth GFM task-list marker (`- [ ]` ⇄ `- [x]`) in markdown source.
 *
 *  `taskIndex` is the 0-based source order of the task item — the same order
 *  the rendered preview tags onto each checkbox (`data-md-task`), so clicking
 *  the Nth checkbox toggles the Nth marker. The scan recognizes the same
 *  task-bearing contexts the renderer does: bare list items and ones nested in
 *  a blockquote (`> - [ ]`, which `marked` renders as a real checkbox). Fenced
 *  code blocks are skipped so a `- [ ]` inside a ``` block (which `marked` does
 *  not render as a checkbox) never throws the count off.
 *
 *  A leading YAML front-matter block is skipped before scanning — the renderer
 *  strips it (`stripFrontMatter`) before assigning `data-md-task` indices, so a
 *  task-marker-shaped line inside it (a YAML block-sequence value like
 *  `todos:\n  - [ ] x`) is rendered as no checkbox at all. Scanning the raw
 *  content would count that line as index 0, silently corrupting the front
 *  matter and drifting every real task by one; skipping the identical prefix
 *  the renderer drops keeps the two index spaces congruent. The prefix is
 *  preserved verbatim in the rewritten output.
 *
 *  Returns the rewritten content, or `null` when the index is out of range
 *  (e.g. the file changed underneath the open preview), in which case the
 *  caller should leave the file untouched.
 *
 *  Limitation: 4-space *indented* code blocks aren't tracked (fenced blocks
 *  are), so a task-looking line inside one is a rare source of miscount —
 *  documented in `solid-markdown`'s LIMITATIONS. */
export function toggleTaskInSource(
  content: string,
  taskIndex: number,
): string | null {
  // Split off the leading front-matter the renderer drops before indexing, scan
  // only the body the checkboxes are minted from, then re-prepend the prefix
  // verbatim so the rewritten file is byte-identical outside the toggled line.
  const body = stripFrontMatter(content);
  const prefix = content.slice(0, content.length - body.length);
  const rewritten = toggleTaskInBody(body, taskIndex);
  return rewritten === null ? null : prefix + rewritten;
}

/** Flip the Nth task marker in a front-matter-free document body. Split out so
 *  `toggleTaskInSource` can offset the result back over the stripped prefix. */
function toggleTaskInBody(content: string, taskIndex: number): string | null {
  const lines = content.split("\n");
  // A list item (unordered -,*,+ or ordered 1. / 1)) whose first content is a
  // task marker `[ ]` / `[x]` / `[X]`. An optional blockquote prefix (`>`, one
  // or more for nested quotes, with surrounding whitespace) is allowed because
  // `marked` renders a task list inside a blockquote (`> - [ ] x`) as a real
  // checkbox — so the renderer indexes it (`data-md-task`) and the scan must
  // too, or the two counters drift and a click toggles the wrong line. The
  // prefix lands in group 1 and is re-emitted verbatim on rewrite.
  //
  // After the close bracket `marked` only mints a checkbox when `]` is
  // followed by whitespace AND non-empty text — `- [ ]typo` (no space, a
  // common author typo), `- [ ]` (bare), and `- [ ] ` (trailing space only)
  // all render as plain text, NOT a checkbox. So the trailing group requires
  // `[ \t]+\S` (a space/tab run then a non-whitespace char) before the rest of
  // the line; without it the scanner over-counts and a click toggles an
  // unrelated line. The `[^\r\n]*` after `\S` stops at a CR/LF so a CRLF line
  // (`- [ ] todo\r` after splitting on `\n`) still matches, and the captured
  // `\r` is re-emitted so the line ending survives the rewrite.
  const TASK =
    /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\][ \t]+\S[^\r\n]*)(\r?)$/;
  // The fence skip tolerates the same blockquote prefix `TASK` does, so a
  // blockquoted fenced block (`> ```` … `> ````) is detected as a fence and
  // its task-looking lines are skipped. Without the prefix, `inFence` would
  // never flip for a quoted fence, yet `> - [ ]` inside it would still match
  // `TASK` — drifting the count past the renderer's `data-md-task` indices.
  // The run of fence chars is captured whole so its length can be compared:
  // CommonMark requires a closing fence to be at least as long as the opener,
  // so a shorter same-char fence inside a longer block (a ``` line inside a
  // ```` block) is body text, not a close. Comparing only the char would flip
  // `inFence` off early, mis-tracking the rest of the document.
  const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;

  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(FENCE);
    if (fence) {
      const run = fence[1] ?? "";
      const marker = run[0] ?? "";
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
        fenceLen = run.length;
      } else if (marker === fenceChar && run.length >= fenceLen) {
        // A same-char run only closes when it's ≥ the opener's length
        // (CommonMark §4.5); a shorter run is part of the code block's body.
        inFence = false;
        fenceChar = "";
        fenceLen = 0;
      }
      continue;
    }
    if (inFence) continue;

    const task = line.match(TASK);
    if (!task) continue;
    if (count === taskIndex) {
      const next = task[2] === " " ? "x" : " ";
      lines[i] = `${task[1]}${next}${task[3]}${task[4] ?? ""}`;
      return lines.join("\n");
    }
    count++;
  }
  return null;
}
