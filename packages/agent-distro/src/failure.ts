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
 * can be megabytes. The reader is total — any string reads.
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

/** Reader: any failure text → its headline (the first line) and its detail
 *  (the rest, each line right-trimmed, blank ends dropped). */
export function failureWords(message: string): FailureWords {
  const [headline = "", ...rest] = message.split(NEWLINE);
  return {
    headline,
    detail: withoutBlankEnds(rest.map((line) => line.trimEnd())),
  };
}

/** Writer: a one-line cause and raw evidence → the one string that crosses.
 *  The headline is flattened to one line; the evidence keeps its last
 *  {@link FAILURE_DETAIL_LINES} lines (saying how many it cut) — or nothing,
 *  when all it says is already in the headline (a one-line Nix error is not
 *  said twice). */
export function failureMessage(headline: string, evidence: string): string {
  const head = capped(
    headline
      .split(/\s*\r?\n\s*/)
      .join(" ")
      .trim(),
  );
  const lines = withoutBlankEnds(
    evidence.split(NEWLINE).map((line) => line.trimEnd()),
  );
  const said = lines
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
  if (said === "" || head.includes(said)) return head;
  const cut = lines.length - FAILURE_DETAIL_LINES;
  const kept =
    cut > 0
      ? [
          `… ${cut} earlier ${cut === 1 ? "line" : "lines"} not shown`,
          ...lines.slice(cut),
        ]
      : lines;
  return [head, ...kept.map(capped)].join("\n");
}
