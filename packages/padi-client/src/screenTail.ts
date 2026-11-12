/** **The tail of padi's rendered screen — what `screen.text { tail: N }` means.**
 *
 *  The rendered buffer ends in the empty viewport below the cursor, which
 *  carries zero information and would otherwise BE the tail: `tail: 6` on a
 *  fresh shell once returned six blank lines — a real bug, caught on the MCP
 *  face. So "the last N lines" is defined here as a fold over the WHOLE
 *  rendered text: drop the trailing run of whitespace-only rows first, then
 *  keep the last N.
 *
 *  padi applies it before replying when a caller passes `tail` to `screen.text`
 *  (`PadiScreenTextInputSchema`, `./surface`), reading a window wider than N
 *  rather than the scrollback (`@kolu/padi`'s `screenTextTail.ts`). It is a
 *  published entry rather than a padi-private helper because it is the
 *  CONTRACT of that reply, and is read as one outside this repository: olai
 *  imports it to cut its own tail. A test that pins "`tail: N` is
 *  `tailLines(whole, N)`" reads it from here for the same reason.
 *
 *  This file imports NOTHING; see `./terminalId` for why that is a contract, not an accident. */

/** The last `tail` lines of a rendered screen, with the trailing run of
 *  whitespace-only rows dropped first. Blank lines BETWEEN content are kept
 *  verbatim — they are what the terminal printed. */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - tail), end).join("\n");
}
