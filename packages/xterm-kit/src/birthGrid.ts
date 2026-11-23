/** The grid every terminal is born at: 80×24, the VT100's.
 *
 *  One number for three readers, so they cannot drift apart:
 *  - kaval spawns a PTY at it when nothing asked for a size;
 *  - `<Xterm>` seeds its drawn grid with it, because an unmeasured xterm
 *    really is this size (its constructor invents it);
 *  - a Conductor pane never asks for less on either axis, so looking at a
 *    terminal can grow it past the size it was born at but never squeeze it.
 *
 *  Runtime-neutral and import-free, so the daemon's root barrel carries it. */
export const BIRTH_GRID: { readonly cols: number; readonly rows: number } =
  Object.freeze({ cols: 80, rows: 24 });
