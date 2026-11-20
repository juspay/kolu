import { tailLines } from "@kolu/padi-client/screenTail";

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
    const answer = tailLines(text, tail);
    const kept = answer === "" ? 0 : answer.split("\n").length;
    const rows = text.split("\n").length;
    if (kept === tail || rows < window) return answer;
    window = kept > 0 ? rows - kept + tail : window * 2;
  }
}
