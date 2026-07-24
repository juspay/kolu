/**
 * Turning a raw-mode read into keys.
 *
 * In raw mode a single keypress can be several bytes (an arrow key is
 * `ESC [ A`) and several keypresses can arrive in one chunk (a fast typist, or
 * pasted text). Splitting is its own concern so the key handling in `main.ts`
 * only ever sees one key at a time — and so the splitting itself is testable
 * without a terminal.
 */

/** Split a raw-mode chunk into individual keys, keeping CSI escape sequences
 *  (`ESC [ … final`) whole so an arrow key counts as one key, not three. */
export function splitKeys(chunk: string): string[] {
  const keys: string[] = [];
  let index = 0;
  while (index < chunk.length) {
    if (chunk[index] === "\x1b" && chunk[index + 1] === "[") {
      // CSI: ESC [ then parameter bytes, terminated by a final byte in @–~.
      let end = index + 2;
      while (end < chunk.length && !/[@-~]/.test(chunk[end] ?? "")) end += 1;
      keys.push(chunk.slice(index, end + 1));
      index = end + 1;
      continue;
    }
    keys.push(chunk[index] ?? "");
    index += 1;
  }
  return keys;
}
