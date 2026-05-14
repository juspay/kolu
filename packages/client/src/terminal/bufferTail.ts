/** Extract the last N non-empty lines from an xterm buffer as plain text.
 *
 *  Used by the awaiting dock to peek at what an agent last said without
 *  owning a second xterm instance or re-rendering ANSI colors. Walks the
 *  buffer bottom-up so the result hugs the most recent output, skipping
 *  trailing blank lines that TUIs leave below their input row. */

import type { Terminal as XTerm } from "@xterm/xterm";

export function tailBuffer(xterm: XTerm, n: number): string[] {
  const buf = xterm.buffer.active;
  const out: string[] = [];
  for (let y = buf.length - 1; y >= 0 && out.length < n; y--) {
    const text = buf.getLine(y)?.translateToString(true) ?? "";
    if (text.length === 0 && out.length === 0) continue;
    out.push(text);
  }
  return out.reverse();
}
