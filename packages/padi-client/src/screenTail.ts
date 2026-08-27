/** **The tail of padi's rendered screen — the fold over `screen.text`'s reply.**
 *
 *  A pure fold, and it belongs beside the schema of the reply it folds
 *  (`PadiScreenTextInputSchema`, `./surface`) rather than in the daemon package,
 *  because the rule it encodes is about padi's ANSWER: the rendered buffer ends
 *  in the empty viewport below the cursor, which carries zero information and
 *  would otherwise BE the tail. `tail: 6` on a fresh shell returned six blank
 *  lines — a real bug, caught on the MCP face.
 *
 *  It moved out of `@kolu/padi/render` for the reason that package's own README
 *  gave for keeping it there ("move them the day one asks"): a consumer that
 *  dials a padi and keeps the last N lines of a screen had to reach a manifest
 *  naming `columnify`, `kaval` and `node-pty` to do it, so it wrote the three
 *  lines out instead — with its header saying exactly that. `@kolu/padi/render`
 *  re-exports this, so kolu's own two faces are unchanged.
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
