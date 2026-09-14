/**
 * Output that moves or restyles the CURSOR and nothing else — no glyph, no
 * erase, no scroll, no screen switch. A TUI renderer that repaints on a fixed
 * frame loop emits exactly this while visually idle: OpenTUI (Xyne CLI) parks
 * the cursor once per frame as
 * `ESC[?2026h ESC[?25l ESC[0m ESC[<row>;<col>H ESC[?25h ESC[?2026l`.
 *
 * Deliberately a closed allow-list: a chunk is cursor-only only when EVERY
 * byte belongs to one of the sequences below. Anything else — a printable
 * character, a control byte, an unlisted CSI, an OSC, a sequence split across
 * chunks — makes the chunk count as real output, so this can only ever
 * under-report inertness, never hide a visible change.
 *
 *  - CSI cursor movement: CUU/CUD/CUF/CUB/CNL/CPL/CHA/CUP/VPA/HVP
 *    (`A B C D E F G H d f`)
 *  - CSI SGR (`m`) — changes the pen for LATER text, no cell
 *  - DEC private set/reset (`?…h` / `?…l`) of cursor blink (12), cursor
 *    visibility (25) and synchronized output (2026) only
 *  - DECSC / DECRC (`ESC 7` / `ESC 8`)
 */
const CURSOR_ONLY_SEQUENCE =
  /\x1b\[[0-9;:]*[ABCDEFGHdfm]|\x1b\[\?(?:12|25|2026)(?:;(?:12|25|2026))*[hl]|\x1b[78]/y;

export function isCursorOnlyOutput(data: string): boolean {
  if (data.length === 0) return false;
  CURSOR_ONLY_SEQUENCE.lastIndex = 0;
  while (CURSOR_ONLY_SEQUENCE.lastIndex < data.length) {
    if (!CURSOR_ONLY_SEQUENCE.test(data)) return false;
  }
  return true;
}
