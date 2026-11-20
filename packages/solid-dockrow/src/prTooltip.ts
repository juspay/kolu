import { type CheckStatus, type PrInfo, prLabel } from "anyforge/schemas";

const CHECKS: Record<CheckStatus, { label: string; glyph: string }> = {
  pass: { label: "all pass", glyph: "✓" },
  pending: { label: "pending", glyph: "…" },
  fail: { label: "fail", glyph: "✗" },
};

export function prTooltip(pr: PrInfo): string {
  if (pr.checks === null) return prLabel(pr);
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
