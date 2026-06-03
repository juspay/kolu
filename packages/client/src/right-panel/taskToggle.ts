/** Flip the Nth GFM task-list marker (`- [ ]` ⇄ `- [x]`) in markdown source.
 *
 *  `taskIndex` is the 0-based source order of the task item — the same order
 *  the rendered preview tags onto each checkbox (`data-md-task`), so clicking
 *  the Nth checkbox toggles the Nth marker. Fenced code blocks are skipped so a
 *  `- [ ]` inside a ``` block (which `marked` does not render as a checkbox)
 *  never throws the count off.
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
  // task marker `[ ]` / `[x]` / `[X]`. The trailing group stops at a CR/LF so a
  // CRLF-encoded line (`- [ ] todo\r` after splitting on `\n`) still matches,
  // and the captured `\r` is re-emitted so the line ending survives the rewrite.
  const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\][^\r\n]*)(\r?)$/;
  const FENCE = /^\s*(`{3,}|~{3,})/;

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
