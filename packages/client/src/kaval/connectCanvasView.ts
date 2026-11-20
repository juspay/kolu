export const TAIL_LINES = 6;

export function tailOf<Line>(
  log: readonly Line[],
  lines: number = TAIL_LINES,
): readonly Line[] {
  return log.slice(-lines);
}

export function showsElapsed(elapsedMs: number | null): boolean {
  return elapsedMs !== null && elapsedMs >= 1000;
}
