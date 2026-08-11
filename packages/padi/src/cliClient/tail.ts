/**
 * The tail-mode slice of a rendered screen — one pure fold, zero imports.
 *
 * It sat in `render.ts` until the wait kit became its third consumer (`kolu wait
 * --snapshot` stamps a met outcome with the rendered tail). `render.ts` pulls in
 * `columnify` at module load for the roster table, and reaching it from
 * `watch.ts` would have put a table formatter into the module graph of every
 * `kolu wait` and every `kolu mcp` — a dependency arrow drawn for a six-line
 * function. So the leaf moved out and `render.ts` re-exports it: every existing
 * `@kolu/padi/render` consumer's import is unchanged.
 */

/** The last `tail` lines of a rendered screen, with the trailing run of
 *  whitespace-only rows dropped first.
 *
 *  A pure fold over `screen.text`'s output, and it lives beside padi's other
 *  formatters because the rule it encodes is about padi's REPLY: the rendered
 *  buffer ends in the empty viewport below the cursor, which carries zero
 *  information and would otherwise BE the tail (`tail: 6` on a fresh shell
 *  returned six blank lines — a real bug, caught on the MCP face). Blank lines
 *  BETWEEN content are kept verbatim.
 *
 *  It was `kolu-mcp/screenText`'s until `kolu snapshot --tail` became its second
 *  consumer and imported it from there — a CLI verb reaching sideways into a
 *  sibling FACE's adapter for domain knowledge, which also made `cli.ts`'s
 *  per-face fence claim false (a terminal verb was building an MCP argument
 *  schema at module load). Every face now imports it from the package that owns
 *  the reply it folds. */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - tail), end).join("\n");
}
