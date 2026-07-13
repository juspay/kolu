/** The `kaval-tui history` full-dump page-materialization rule, extracted as a
 *  pure function so it is unit-testable without standing up a real kaval (the
 *  smoke test in `history.test.ts` drives the wire; this pins the branch logic).
 *
 *  Each `getHistory` reply is turned into the text to emit for that page:
 *   - A non-empty chunk is emitted verbatim (VT-serialized bytes).
 *   - An EMPTY chunk that still SPANS rows (`before - topLine > 0`) is an
 *     all-blank run of scrollback: `serialize({range})` collapses it to "", but
 *     those blank rows are real content, so materialize them as blank lines
 *     rather than dropping the page — else a blank run silently compresses the
 *     dump's vertical spacing below what the terminal produced (the same F10
 *     fidelity the browser path restores via `servedRows`).
 *   - An empty chunk on the SELF-SEEDED first page (`before === undefined`) is
 *     skipped: its span isn't known client-side (there's no prior cursor to
 *     subtract), so a leading blank run there is the one uncovered edge.
 *
 *  Returns the page text to push, or `null` when this reply contributes no page.
 */
export function materializeHistoryPage(
  chunk: string,
  before: number | undefined,
  topLine: number,
): string | null {
  if (chunk !== "") return chunk;
  if (before === undefined) return null;
  const span = before - topLine;
  return span > 0 ? "\n".repeat(span) : null;
}
