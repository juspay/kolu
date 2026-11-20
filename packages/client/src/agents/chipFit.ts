export function chipsThatFit(
  widths: readonly number[],
  plusWidth: number,
  gap: number,
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
