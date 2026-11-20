export function materializeHistoryPage(
  chunk: string,
  before: number | undefined,
  topLine: number,
): string | null {
  if (chunk !== "") return chunk;
  if (before === undefined) return null;
  const blankRun = before - topLine;
  return blankRun > 0 ? "\n".repeat(blankRun) : null;
}
