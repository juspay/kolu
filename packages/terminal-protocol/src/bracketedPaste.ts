/**
 * Bracketed-paste delimiters (xterm `?2004`). When the mode is on, the
 * terminal wraps every paste in these markers so programs can tell pasted
 * text from typed text. Kolu touches them at four altitudes — the server
 * injects a path as a paste (`router.ts`), kolu-tui's escape scanner suspends
 * escape recognition between them, padi reads a submit only OUTSIDE them
 * (`submitInput.ts`), and the snapshot reset turns the mode off — so the bytes
 * live here, once.
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

/** Where a stream of input stands with respect to bracketed paste. */
export interface PasteTracker {
  /** Is the stream inside a paste NOW — past a start marker's last unit and
   *  not yet past the matching end marker's last unit? Read it BEFORE feeding
   *  a unit to ask whether that unit is pasted content. */
  readonly inPaste: boolean;
  /** Feed the next code unit of the stream (a byte, or a UTF-16 unit — the
   *  markers are ASCII, so either alphabet matches them the same way). */
  step(code: number): void;
}

/** One step of the incremental marker matcher: the next match position after
 *  seeing `code` at position `pos` of `marker`. A failed match can still be
 *  the START of a fresh marker (e.g. the ESC after "\x1b\x1b["), so position
 *  0 is re-checked rather than skipped. */
const advanceMarker = (pos: number, marker: string, code: number): number => {
  if (code === marker.charCodeAt(pos)) return pos + 1;
  return code === marker.charCodeAt(0) ? 1 : 0;
};

/**
 * Follow the paste markers through a stream fed one code unit at a time. The
 * state survives chunk boundaries, so a marker split across two reads still
 * flips it — which is the whole reason this is a machine and not a regex over
 * one chunk. Every reader that must treat pasted text differently from typed
 * text (kaval-tui's line-start escape, padi's reading of what SUBMITS a prompt)
 * shares this one matcher rather than each counting marker bytes its own way.
 */
export function createPasteTracker(): PasteTracker {
  let inPaste = false;
  let startPos = 0;
  let endPos = 0;
  return {
    get inPaste() {
      return inPaste;
    },
    step(code: number): void {
      if (inPaste) {
        endPos = advanceMarker(endPos, BRACKETED_PASTE_END, code);
        if (endPos === BRACKETED_PASTE_END.length) {
          endPos = 0;
          inPaste = false;
        }
        return;
      }
      startPos = advanceMarker(startPos, BRACKETED_PASTE_START, code);
      if (startPos === BRACKETED_PASTE_START.length) {
        startPos = 0;
        inPaste = true;
      }
    },
  };
}
