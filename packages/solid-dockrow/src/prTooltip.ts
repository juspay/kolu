/** Multi-line PR tooltip — `#N Title` headline, a one-line check summary, then
 *  a per-check list so the user sees exactly which gate is red without opening
 *  the PR. `title` attributes preserve newlines natively across modern
 *  browsers, so the same string renders as a stacked tooltip on every surface
 *  that hangs it on the PR icon: the dock row's PR pip (this package), and in
 *  kolu the tile title bar, the workspace switcher, and the close-confirm
 *  dialog. One source = one verdict everywhere.
 *
 *  It rides with the row rather than with `anyforge/schemas` for the reason it
 *  always did: schemas describe SHAPES, and this composes a display string. The
 *  row is the first and busiest of those surfaces, so the string lives beside
 *  the pip that shows it. */

import { type CheckStatus, type PrInfo, prLabel } from "anyforge/schemas";

const CHECKS: Record<CheckStatus, { label: string; glyph: string }> = {
  pass: { label: "all pass", glyph: "✓" },
  pending: { label: "pending", glyph: "…" },
  fail: { label: "fail", glyph: "✗" },
};

/** ONE CHECK'S LINE, and the outcome the tally counts it under. */
export interface CheckLine {
  readonly line: string;
  readonly outcome: CheckStatus;
}

/** One check run as the tooltip says it. Exported for the REACTIVE reading
 *  beside this module (`./prTooltipFold.ts`), which folds a store-backed PR
 *  run by run and must spell a line the one way. */
export const lineOf = (one: PrInfo["checkRuns"][number]): CheckLine => ({
  line: `  ${CHECKS[one.outcome].glyph} ${one.name}`,
  outcome: one.outcome,
});

/** THE STRING ITSELF, from the headline facts and the checks' lines — the ONE
 *  spelling of the tooltip, so the plain reading and the folded one cannot
 *  say it two ways.
 *
 *  This module reaches no SolidJS edge: a consumer's SERVER folds rows
 *  through `./rowValues.ts`, which re-exports it (`rowValues.purity.test.ts`),
 *  so the fold that needs memos is its own module beside it. */
export function compose(
  pr: Pick<PrInfo, "number" | "title" | "checks">,
  lines: ReadonlyArray<CheckLine>,
): string {
  const head = prLabel(pr as PrInfo);
  if (pr.checks === null) return head;
  // Older server payloads emit `checks` (the rollup) without `checkRuns` (the
  // per-check list); schema defaults the latter to `[]`. Show only the
  // aggregate verdict in that case — the parenthesized "0✓ 0… 0✗" tally would
  // otherwise misrepresent a real check status as "no checks ran".
  if (lines.length === 0)
    return `${head}\n\nChecks: ${CHECKS[pr.checks].label}`;
  const counts: Record<CheckStatus, number> = { pass: 0, pending: 0, fail: 0 };
  for (const one of lines) counts[one.outcome] += 1;
  const summary = `Checks: ${CHECKS[pr.checks].label} (${counts.pass}✓ ${counts.pending}… ${counts.fail}✗)`;
  return `${head}\n\n${summary}\n${lines.map((one) => one.line).join("\n")}`;
}

export function prTooltip(pr: PrInfo): string {
  if (pr.checks === null) return prLabel(pr);
  return compose(pr, pr.checkRuns.map(lineOf));
}
