/**
 * Does this input SUBMIT? — read off the bytes a terminal is sent, the one
 * place a daemon that carries every keystroke can tell "something was handed
 * to the program in front" without asking that program.
 *
 * A submit is the Enter key ({@link NAMED_KEY_BYTES}`.enter`, CR) typed, not
 * pasted and not modified:
 *
 *  - inside a bracketed paste it is a line of the pasted text, which every TUI
 *    that asked for `?2004` keeps in its input rather than submitting
 *    ({@link createPasteTracker});
 *  - after ESC it is Alt+Enter ({@link metaByte}), which the agents kolu
 *    drives read as "a newline in the input", never "send";
 *  - LF is Ctrl+J, the same newline-in-the-input chord.
 *
 * What it cannot see is whether the program ACCEPTED the submit — an Enter
 * into an empty input, a slash-command picker. That is the reader's business:
 * padi treats it as "something was submitted" and lets the screen settling
 * again with no transcript say it was nothing.
 *
 * The paste state is carried across writes — a paste split over two writes is
 * still one paste. The Alt prefix is NOT: a terminal sends Alt+Enter as one
 * write (`ESC CR`), and an ESC that ends a write is the Escape key on its own,
 * which must not swallow the Enter pressed after it.
 */

import { createPasteTracker } from "./bracketedPaste.ts";
import { NAMED_KEY_BYTES } from "./keyInput.ts";

const ENTER = NAMED_KEY_BYTES.enter.charCodeAt(0);
const ESC = NAMED_KEY_BYTES.escape.charCodeAt(0);

/** A scanner for one terminal's input stream: feed it each write, in order;
 *  it answers whether that write submitted. */
export type SubmitScanner = (input: string) => boolean;

export function createSubmitScanner(): SubmitScanner {
  const paste = createPasteTracker();
  return (input) => {
    // Was the unit before this one an ESC outside a paste — the Alt prefix?
    let afterEsc = false;
    let submitted = false;
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      const pasted = paste.inPaste;
      paste.step(code);
      if (pasted) {
        afterEsc = false;
        continue;
      }
      if (code === ENTER && !afterEsc) submitted = true;
      afterEsc = code === ESC;
    }
    return submitted;
  };
}
