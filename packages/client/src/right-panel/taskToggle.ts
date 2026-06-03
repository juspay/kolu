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
  const lines = content.split("\n");
  // A list item (unordered -,*,+ or ordered 1. / 1)) whose first content is a
  // task marker `[ ]` / `[x]` / `[X]`. An optional blockquote prefix (`>`, one
  // or more for nested quotes, with surrounding whitespace) is allowed because
  // `marked` renders a task list inside a blockquote (`> - [ ] x`) as a real
  // checkbox — so the renderer indexes it (`data-md-task`) and the scan must
  // too, or the two counters drift and a click toggles the wrong line. The
  // prefix lands in group 1 and is re-emitted verbatim on rewrite. The trailing
  // group stops at a CR/LF so a CRLF-encoded line (`- [ ] todo\r` after
  // splitting on `\n`) still matches, and the captured `\r` is re-emitted so
  // the line ending survives the rewrite.
  const TASK = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\][^\r\n]*)(\r?)$/;
  // The fence skip tolerates the same blockquote prefix `TASK` does, so a
  // blockquoted fenced block (`> ```` … `> ````) is detected as a fence and
  // its task-looking lines are skipped. Without the prefix, `inFence` would
  // never flip for a quoted fence, yet `> - [ ]` inside it would still match
  // `TASK` — drifting the count past the renderer's `data-md-task` indices.
  const FENCE = /^\s*(?:>\s*)*(`{3,}|~{3,})/;

  let inFence = false;
  let fenceChar = "";
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(FENCE);
    if (fence) {
      const marker = (fence[1] ?? "")[0] ?? "";
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = "";
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
