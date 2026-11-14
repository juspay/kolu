/**
 * How a failure's text is written and read — the one convention every
 * agent-distro failure crosses the wire in. A failure is ONE string on the
 * field that already carries it (a delivery report's `message`, a status's
 * `error.message`, a run's `words`, a receipt's `error`, a profile's
 * resolution): its first line is the cause, said whole; any lines after it are
 * the evidence (what Nix or the copy printed). No field of its own, so no
 * schema moves — and a message written by anyone who never heard of this
 * convention (upstream's updater, padi's own errors) reads as a cause with
 * whatever lines it happened to carry.
 *
 * The writer caps what it keeps: the text is held in padi's memory and
 * republished whole with the receipt cell on every change, and Nix's stderr
 * can be megabytes. The reader is total — any string reads. kolu-server
 * writes (`profiles.ts`, `delivery.ts` — which also reads, to tell a bare
 * cause from one that brings its own evidence); `./status` reads.
 */

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

/** The lines without blank ones at either end. */
function withoutBlankEnds(lines: readonly string[]): readonly string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") start++;
  while (end > start && lines[end - 1]?.trim() === "") end--;
  return lines.slice(start, end);
}

/** `line`, cut to {@link FAILURE_LINE_CHARS} with a closing "…". */
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

/** Does `lines`, each trimmed and joined with single spaces, say nothing the
 *  headline does not? Stops as soon as the join would outgrow the headline —
 *  it cannot be inside it then — so megabytes of evidence are never copied
 *  to ask. */
function saidBy(head: string, lines: readonly string[]): boolean {
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
  if (saidBy(head, lines)) return head;
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
