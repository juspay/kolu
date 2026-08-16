import type { StyledLine } from "../styled.ts";
import { lineText } from "../styled.ts";

/** Keep a locked paint window on the same content after a PTY write.
 *  Growth (the streaming case) is a totalRows delta — no restyle.
 *  A prune shrinks the buffer; re-pin by the first visible line. */
export function adjustLockedViewOffset(
  viewOffset: number,
  beforeTotal: number,
  afterTotal: number,
  rows: number,
  needle: string,
  afterLines: StyledLine[],
): number {
  if (afterTotal > beforeTotal) return viewOffset + (afterTotal - beforeTotal);
  if (afterTotal < beforeTotal && needle.length > 0) {
    return repinLockedViewOffset(rows, needle, afterLines) ?? viewOffset;
  }
  return viewOffset;
}

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
