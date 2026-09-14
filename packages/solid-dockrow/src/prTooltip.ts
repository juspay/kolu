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

export function prTooltip(pr: PrInfo): string {
  if (pr.checks === null) return prLabel(pr);
  // Older server payloads emit `checks` (the rollup) without `checkRuns` (the
  // per-check list); schema defaults the latter to `[]`. Show only the
  // aggregate verdict in that case — the parenthesized "0✓ 0… 0✗" tally would
  // otherwise misrepresent a real check status as "no checks ran".
  if (pr.checkRuns.length === 0) {
    return `${prLabel(pr)}\n\nChecks: ${CHECKS[pr.checks].label}`;
  }
  const counts = pr.checkRuns.reduce(
    (acc, c) => {
      acc[c.outcome] += 1;
      return acc;
    },
    { pass: 0, pending: 0, fail: 0 },
  );
  const summary = `Checks: ${CHECKS[pr.checks].label} (${counts.pass}✓ ${counts.pending}… ${counts.fail}✗)`;
  const list = pr.checkRuns
    .map((c) => `  ${CHECKS[c.outcome].glyph} ${c.name}`)
    .join("\n");
  return `${prLabel(pr)}\n\n${summary}\n${list}`;
}
