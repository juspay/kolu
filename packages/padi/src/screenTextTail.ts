/** **`screen.text { tail: N }` — the last N lines, without the scrollback.**
 *
 *  The answer is DEFINED as `tailLines(whole, N)` (`@kolu/padi-client/screenTail`):
 *  drop the trailing run of whitespace-only rows, then keep the last N. kaval
 *  can read a tail of its own (`extent: { kind: "tail" }`), but it counts rows
 *  of the buffer, and a buffer ends in the blank viewport below the cursor —
 *  so forwarding N as is would hand a fresh shell's caller N blank lines. The
 *  whitespace rule is a fact about padi's ANSWER, so the cut stays here.
 *
 *  What makes it cheap is reading a WINDOW wider than N instead of the whole
 *  buffer: N plus a slack (the terminal's grid rows, which is how much blank
 *  viewport there can be below the cursor), folded with `tailLines`. The
 *  window is exactly enough when it holds N content lines, or when it already
 *  reached the top of the buffer. Otherwise it widens and reads again:
 *
 *   - the window held SOME content: its trailing blank run is now known in
 *     full, so the next window is that run plus N — one more read;
 *   - the window was ALL blank: the run is longer than the window, so it
 *     doubles.
 *
 *  Each widening strictly grows the window, and a window past the buffer's
 *  length comes back short and ends the loop — so it terminates even while
 *  output lands between reads. The reply is always one read's fold, never a
 *  splice of two. */

import { contentEnd, tailLines } from "@kolu/padi-client/screenTail";

/** The last `tail` lines of a screen, read through `read(window)` — which
 *  returns the last `window` rows of the rendered buffer (fewer when the
 *  buffer is shorter), rows joined by `\n`. `slack` sizes the first window
 *  past `tail`; it changes how many reads a call costs, never its answer. */
export async function readScreenTail(
  read: (window: number) => Promise<string>,
  tail: number,
  slack: number,
): Promise<string> {
  let window = tail + slack;
  for (;;) {
    const text = await read(window);
    const lines = text.split("\n");
    const end = contentEnd(lines);
    if (end >= tail || lines.length < window) return tailLines(text, tail);
    window = end > 0 ? lines.length - end + tail : window * 2;
  }
}
