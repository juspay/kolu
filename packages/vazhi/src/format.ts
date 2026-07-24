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
export function hyperlink(url: string, text: string = url): string {
  return `${OSC}8;;${url}${BEL}${text}${OSC}8;;${BEL}`;
}
