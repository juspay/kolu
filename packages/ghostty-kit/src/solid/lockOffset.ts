import type { StyledLine } from "../styled.ts";
import { lineText } from "../styled.ts";

/** Find `needle` in `afterLines` and return the viewOffset that puts it
 *  at the top of the painted window. Null when the line is gone. */
export function repinLockedViewOffset(
  rows: number,
  needle: string,
  afterLines: StyledLine[],
): number | null {
  if (needle.length === 0) return null;
  const found = afterLines.findIndex((l) => lineText(l) === needle);
  if (found < 0) return null;
  return Math.max(0, afterLines.length - rows - found);
}
