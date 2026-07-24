/**
 * The pure pieces of vazhi's screen: how a forward reads as text.
 *
 * Kept out of the components so the things worth pinning — an uptime that says
 * something at every scale, a selection that stays on a real row, a URL that a
 * terminal will linkify — are testable without rendering anything.
 */

/** Whatever a thrown value has to say for itself. */
export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** How long a forward has been up, in the coarsest unit that still says
 *  something: seconds under a minute, then minutes, then hours, then days.
 *
 *  Deliberately a second implementation of the ladder in
 *  `packages/client/src/time/duration.ts` (`compactDelta`), not an import of
 *  it: vazhi's PRT0 criterion is that its ONLY kolu import is
 *  `@kolu/port-forward`, and reaching into the browser client would point an
 *  app→app arrow. Nine lines is the honest price of that independence — keep
 *  the thresholds (sec<60 / min<60 / hr<24) and the negative clamp identical to
 *  that file if either ever changes. */
export function formatUptime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The URL a forward answers on. The host is THIS machine's name — never
 *  "localhost", which in a link means the machine of whoever is reading it. */
export function forwardUrl(hostname: string, localPort: number): string {
  return `http://${hostname}:${localPort}`;
}

/** What the prompt should do with the text it now holds.
 *
 *  A key at a time, this is always "keep typing" — Enter is a key event, not
 *  text. But a PASTE (or a harness driving the pty) arrives as ONE event
 *  carrying the whole line INCLUDING its newline, which a text input has no
 *  reason to treat as anything but characters. So the newline is read here the
 *  way a terminal reads it: it ends the entry. */
export type PromptInput =
  | { kind: "typing"; value: string }
  | { kind: "submit"; value: string };

export function readPromptInput(input: string): PromptInput {
  const newline = input.search(/[\r\n]/);
  return newline === -1
    ? { kind: "typing", value: input }
    : { kind: "submit", value: input.slice(0, newline) };
}

/** The two control characters an OSC 8 hyperlink is made of. Written as char
 *  codes rather than as literal escapes so the source stays readable text. */
const OSC = `${String.fromCharCode(27)}]`;
const BEL = String.fromCharCode(7);

/** Wrap text in an OSC 8 hyperlink, so the URL is clickable in kolu's terminal
 *  and every other terminal that speaks OSC 8.
 *
 *  Emitted UNCONDITIONALLY — no capability detection. A terminal that doesn't
 *  understand OSC 8 ignores the sequence and shows the text, which is already
 *  the URL, so there is nothing to degrade to; whereas a detection library
 *  keyed on `$TERM` would get kolu's own terminal wrong and drop the link where
 *  it matters most. */
export function hyperlink(url: string): string {
  return `${OSC}8;;${url}${BEL}${url}${OSC}8;;${BEL}`;
}

/** What the table can actually show, and what is scrolled out of sight.
 *
 *  Ink's flex layout does NOT do this for us: given more rows than fit, it
 *  shrinks the column and drops a *sample* (measured: 20 forwards in a 10-row
 *  terminal rendered h2, h5, h8, h11, … and pushed the status line and the key
 *  legend off the screen entirely). A sample is the one thing a list of things
 *  you can act on must never be — `x` would cancel a row the operator cannot
 *  see. So the window is computed, not delegated: a CONTIGUOUS run that always
 *  contains the selection, with the counts on either side reported so the
 *  screen can say what it is hiding.
 *
 *  `lines` is every line the table may occupy, INCLUDING the "N more"
 *  indicators — they are rows on the screen too, and forgetting to pay for them
 *  is how the shrink comes back (measured, once, in this same function). */
export function viewport<T extends { readonly key: string }>(opts: {
  rows: readonly T[];
  selectedKey: string | undefined;
  lines: number;
}): { rows: readonly T[]; above: number; below: number } {
  const { rows, selectedKey } = opts;
  const lines = Math.max(0, Math.floor(opts.lines));
  if (lines === 0 || rows.length === 0) {
    return { rows: [], above: 0, below: rows.length };
  }
  if (rows.length <= lines) return { rows, above: 0, below: 0 };

  const anchor = Math.max(
    0,
    rows.findIndex((row) => row.key === selectedKey),
  );
  // One indicator if the window is pinned to an end, two if it floats. Try the
  // roomier shape first and keep it only if it really needs just one.
  for (const capacity of [lines - 1, lines - 2]) {
    if (capacity < 1) continue;
    const start = Math.min(
      Math.max(anchor - Math.floor(capacity / 2), 0),
      rows.length - capacity,
    );
    const above = start;
    const below = rows.length - start - capacity;
    const indicators = (above > 0 ? 1 : 0) + (below > 0 ? 1 : 0);
    if (capacity + indicators <= lines) {
      return { rows: rows.slice(start, start + capacity), above, below };
    }
  }
  // Too little room for even one row PLUS its indicators. The row wins: a
  // screen that shows only "↑ 9 more" tells the operator nothing and hides the
  // thing `x` would act on. So show the selection and drop the indicators —
  // the counts are still returned, and the header already says how many
  // forwards there are.
  const only = rows.slice(anchor, anchor + 1);
  return { rows: only, above: anchor, below: rows.length - anchor - 1 };
}

/** Squeeze text onto exactly one terminal row.
 *
 *  The frame reserves ONE row for the status line, and a status can carry ssh's
 *  own diagnostics — bounded, but still thousands of characters. Left to wrap,
 *  it eats the rows the table and the key legend were promised, which is the
 *  same layout failure the viewport exists to prevent, arriving by another
 *  door. Newlines become spaces (a wrapped line is still a line) and the tail
 *  is cut with an ellipsis so it is visible that there was more. */
export function oneLine(text: string, columns: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const width = Math.max(1, columns);
  return flat.length <= width ? flat : `${flat.slice(0, width - 1)}…`;
}
