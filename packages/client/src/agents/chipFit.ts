/** How many of a row of chips fit, whole, in the room there is — the rest go
 *  behind one `+N` chip. Pure; `TileTip.tsx` measures and feeds it. */

/** The count of leading chips to show. All of them when they fit, and a lone
 *  chip always (a `+N` hiding one chip saves nothing); otherwise as many as
 *  fit beside the `+N` chip (possibly none). Chips never wrap and are never
 *  cut. */
export function chipsThatFit(
  /** Each chip's width, in order. */
  widths: readonly number[],
  /** The `+N` chip's width. */
  plusWidth: number,
  /** The space between two chips. */
  gap: number,
  /** The row's width. */
  room: number,
): number {
  const span = (n: number) =>
    widths.slice(0, n).reduce((sum, w) => sum + w, 0) +
    Math.max(0, n - 1) * gap;
  if (widths.length <= 1 || span(widths.length) <= room) return widths.length;
  let n = widths.length - 1;
  while (n > 0 && span(n) + gap + plusWidth > room) n--;
  return n;
}
