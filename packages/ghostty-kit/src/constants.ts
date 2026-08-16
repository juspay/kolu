/** Result / option / data tag numbers from libghostty-vt `types.h` + `terminal.h`.
 *  These are ABI constants of the pinned wasm, not a second engine. */

export const GHOSTTY_SUCCESS = 0;

export const FORMAT_PLAIN = 0;
export const FORMAT_VT = 1;
export const FORMAT_HTML = 2;

export const OPT_USERDATA = 0;
export const OPT_WRITE_PTY = 1;
export const OPT_TITLE_CHANGED = 5;
export const OPT_PWD_CHANGED = 25;
export const OPT_SCROLLBACK_MAX_LINES = 28;
export const OPT_CONTINUATION_MAX_BYTES = 31;

export const DATA_CURSOR_X = 3;
export const DATA_CURSOR_Y = 4;
export const DATA_ACTIVE_SCREEN = 6;
export const DATA_TITLE = 12;
export const DATA_PWD = 13;
export const DATA_TOTAL_ROWS = 14;
export const DATA_SCROLLBACK_ROWS = 15;

/** Default continuation retention so snapshot encode can capture unfinished VT. */
export const CONTINUATION_MAX_BYTES = 4096;
