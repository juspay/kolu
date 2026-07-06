/**
 * Bracketed-paste delimiters (xterm `?2004`). When the mode is on, the
 * terminal wraps every paste in these markers so programs can tell pasted
 * text from typed text. Kolu touches them at three altitudes — the server
 * injects a path as a paste (`router.ts`), kolu-tui's escape scanner suspends
 * escape recognition between them, and the snapshot reset turns the mode off
 * — so the bytes live here, once.
 *
 * Plain strings (latin1-safe, all ASCII): byte-level consumers convert at
 * their boundary (`Buffer.from(BRACKETED_PASTE_START, "latin1")`).
 */
export const BRACKETED_PASTE_START = "\x1b[200~";
export const BRACKETED_PASTE_END = "\x1b[201~";

/**
 * Wrap a string as ONE bracketed-paste block: `START + text + END`. The marker
 * pair and their ordering are a single concept — this owns it so consumers
 * don't each re-derive the sandwich (the CLI `send`, the rich client's own
 * paste path, the compose box). WHETHER to wrap stays the caller's decision.
 */
export function wrapBracketedPaste(text: string): string {
  return `${BRACKETED_PASTE_START}${text}${BRACKETED_PASTE_END}`;
}
