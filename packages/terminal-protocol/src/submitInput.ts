/**
 * Does this input SUBMIT? — read off the bytes a terminal is sent, the one
 * place a daemon that carries every keystroke can tell "something was handed
 * to the program in front" without asking that program.
 *
 * WHICH keys submit is not this module's to know: it revs with the agents (each
 * agent's own say recipe names the key that submits to it, re-verified per
 * release), so the caller passes the key NAMES and this module only owns how
 * they are read out of a stream. A submit is one of those keys typed, not
 * pasted and not modified:
 *
 *  - inside a bracketed paste it is a line of the pasted text, which every TUI
 *    that asked for `?2004` keeps in its input rather than submitting
 *    ({@link createPasteTracker});
 *  - after ESC it is the Alt chord (`ESC CR` is Alt+Enter), which the agents
 *    kolu drives read as "a newline in the input", never "send".
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
import { encodeKey, NAMED_KEY_BYTES } from "./keyInput.ts";

const ESC = NAMED_KEY_BYTES.escape.charCodeAt(0);

/** A scanner for one terminal's input stream: feed it each write, in order;
 *  it answers whether that write submitted. */
export type SubmitScanner = (input: string) => boolean;

/** Build a scanner that reads `submitKeys` (key names in {@link encodeKey}'s
 *  grammar — `"Enter"`, `"C-s"`) as submits. Each must encode to ONE code unit:
 *  a multi-byte key cannot be told apart from the escape sequences around it a
 *  unit at a time, and a key name nothing encodes is a registry typo — both are
 *  refused here, at construction, rather than read as "never submits". */
export function createSubmitScanner(
  submitKeys: readonly string[],
): SubmitScanner {
  const submits = new Set<number>();
  for (const name of submitKeys) {
    const bytes = encodeKey(name);
    if (bytes === undefined || bytes.length !== 1) {
      throw new Error(
        `createSubmitScanner: submit key ${JSON.stringify(name)} does not encode to one code unit (${JSON.stringify(bytes)})`,
      );
    }
    submits.add(bytes.charCodeAt(0));
  }
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
      if (submits.has(code) && !afterEsc) submitted = true;
      afterEsc = code === ESC;
    }
    return submitted;
  };
}
