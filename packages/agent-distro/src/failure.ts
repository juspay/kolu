export interface FailureWords {
  /** What failed — one line, always shown whole. */
  readonly headline: string;
  /** The evidence under it, a line each; empty when the cause is all there is. */
  readonly detail: readonly string[];
}

/** Evidence kept: the LAST this many lines (the end of a log is where it
 *  failed). */
export const FAILURE_DETAIL_LINES = 40;

/** Any one line (the headline too) is cut to this many characters, ending
 *  "…". */
export const FAILURE_LINE_CHARS = 1000;

const NEWLINE = /\r?\n/;

function withoutBlankEnds(lines: readonly string[]): readonly string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

function capped(line: string): string {
  return line.length <= FAILURE_LINE_CHARS
    ? line
    : `${line.slice(0, FAILURE_LINE_CHARS - 1)}…`;
}

/** Reader: any failure text → its headline (its first non-blank line) and its
 *  detail (the lines after it, each right-trimmed, blank ends dropped). */
export function failureWords(message: string): FailureWords {
  const lines = message.split(NEWLINE);
  const at = lines.findIndex((line) => line.trim() !== "");
  if (at < 0) return { headline: "", detail: [] };
  return {
    headline: lines[at] ?? "",
    detail: withoutBlankEnds(lines.slice(at + 1).map((line) => line.trimEnd())),
  };
}

function alreadyInHeadline(head: string, lines: readonly string[]): boolean {
  const parts: string[] = [];
  let length = -1;
  for (const line of lines) {
    const part = line.trim();
    if (part === "") continue;
    length += part.length + 1;
    if (length > head.length) return false;
    parts.push(part);
  }
  return parts.length === 0 || head.includes(parts.join(" "));
}

/** Writer: a one-line cause and raw evidence → the one string that crosses.
 *  The headline is flattened to one line; the evidence keeps its last
 *  {@link FAILURE_DETAIL_LINES} lines (saying how many it cut, `dropped`
 *  included: lines a caller already let go of before handing the rest in) —
 *  or nothing, when all it says is already in the headline (a one-line Nix
 *  error is not said twice). */
export function failureMessage(
  headline: string,
  evidence: string,
  dropped = 0,
): string {
  const head = capped(
    headline
      .split(NEWLINE)
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(" "),
  );
  const lines = withoutBlankEnds(
    evidence.split(NEWLINE).map((line) => line.trimEnd()),
  );
  if (alreadyInHeadline(head, lines)) return head;
  const cut = Math.max(0, lines.length - FAILURE_DETAIL_LINES);
  const unseen = cut + dropped;
  const kept = [
    ...(unseen > 0
      ? [`… ${unseen} earlier ${unseen === 1 ? "line" : "lines"} not shown`]
      : []),
    ...lines.slice(cut),
  ];
  return [head, ...kept.map(capped)].join("\n");
}
