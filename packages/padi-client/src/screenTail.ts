/** **The tail of padi's rendered screen — what `screen.text { tail: N }` means.**
 *
 *  The rendered buffer ends in the empty viewport below the cursor, which
 *  carries zero information and would otherwise BE the tail: `tail: 6` on a
 *  fresh shell once returned six blank lines — a real bug, caught on the MCP
 *  face. So "the last N lines" is defined here as a fold over the WHOLE
 *  rendered text: drop the trailing run of whitespace-only rows first, then
 *  keep the last N.
 *
 *  padi applies it, server-side, when a caller passes `tail` to `screen.text`
 *  (`PadiScreenTextInputSchema`, `./surface`) — so only the tail crosses the
 *  wire, and no face slices a whole scrollback it was handed. It cannot be
 *  pushed further down: kaval's own `tail` extent counts the blank viewport,
 *  and the whitespace rule is about padi's ANSWER, not kaval's buffer. padi
 *  reads a window wider than N and folds it with {@link tailLines}; see
 *  `@kolu/padi`'s `screenTextTail.ts` for how wide.
 *
 *  It lives beside the reply's schema rather than in the daemon package
 *  because it is the CONTRACT of that reply: a test that pins "`tail: N` is
 *  `tailLines(whole, N)`" reads both sides from here.
 *
 *  This file imports NOTHING; see `./terminalId` for why that is a contract, not an accident. */

/** How many leading lines survive dropping the trailing run of whitespace-only
 *  rows — the index one past the last line with content (0 when there is none). */
export function contentEnd(lines: readonly string[]): number {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === "") end -= 1;
  return end;
}

/** The last `tail` lines of a rendered screen, with the trailing run of
 *  whitespace-only rows dropped first. Blank lines BETWEEN content are kept
 *  verbatim — they are what the terminal printed. */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  const end = contentEnd(lines);
  return lines.slice(Math.max(0, end - tail), end).join("\n");
}
