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
