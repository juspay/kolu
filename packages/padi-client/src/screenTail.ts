/** The last `tail` lines of a rendered screen, with the trailing run of
 *  whitespace-only rows dropped first. Blank lines BETWEEN content are kept
 *  verbatim — they are what the terminal printed. */
export function tailLines(text: string, tail: number): string {
  const lines = text.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] as string).trim() === "") end -= 1;
  return lines.slice(Math.max(0, end - tail), end).join("\n");
}
