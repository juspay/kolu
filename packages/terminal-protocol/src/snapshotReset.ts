/**
 * Undo every terminal mode a replayed `@xterm/addon-serialize` snapshot (or
 * the live deltas after it) may have switched on in the receiving terminal —
 * alt-buffer, mouse tracking, bracketed paste, app cursor/keypad modes. A
 * client that painted a snapshot onto a REAL terminal (kaval-tui attach) must
 * emit this on every exit path, or it leaves the user's shell wrecked;
 * "restore" is much more than un-raw-ing stdin.
 *
 * SOURCE OF TRUTH: this list is the reciprocal of the mode vocabulary
 * `@xterm/addon-serialize` (0.14.x, pinned in `kaval`) can emit in a
 * snapshot (`_serializeModes`). An xterm/serialize upgrade that starts
 * serializing new modes (kitty keyboard, sixel scrolling, …) must extend this
 * reset — audit it on every bump.
 */
export const SNAPSHOT_TTY_RESET =
  "\x1b[?1049l" + // leave the alt screen (back to the user's shell buffer)
  "\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l" + // mouse reporting off
  "\x1b[?1004l" + // focus reporting off
  "\x1b[?2004l" + // bracketed paste off
  "\x1b[?1l\x1b>" + // normal cursor keys + numeric keypad
  "\x1b[?7h" + // autowrap back on
  "\x1b[0m" + // SGR reset
  "\x1b[?25h"; // cursor visible
