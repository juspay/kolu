/** Result / option / data tag numbers from libghostty-vt `types.h` + `terminal.h`.
 *  These are ABI constants of the pinned wasm, not a second engine. */

export const GHOSTTY_SUCCESS = 0;
export const GHOSTTY_OUT_OF_MEMORY = -1;
export const GHOSTTY_INVALID_VALUE = -2;
export const GHOSTTY_OUT_OF_SPACE = -3;
export const GHOSTTY_NO_VALUE = -4;
export const GHOSTTY_IO_ERROR = -5;
export const GHOSTTY_LIMIT_EXCEEDED = -6;

export const FORMAT_PLAIN = 0;
export const FORMAT_VT = 1;
export const FORMAT_HTML = 2;

export const OPT_USERDATA = 0;
export const OPT_WRITE_PTY = 1;
export const OPT_BELL = 2;
export const OPT_TITLE_CHANGED = 5;
export const OPT_TITLE = 9;
export const OPT_PWD = 10;
export const OPT_COLOR_FOREGROUND = 11;
export const OPT_COLOR_BACKGROUND = 12;
export const OPT_COLOR_CURSOR = 13;
export const OPT_COLOR_PALETTE = 14;
export const OPT_PWD_CHANGED = 25;
export const OPT_SCROLLBACK_MAX_BYTES = 27;
export const OPT_SCROLLBACK_MAX_LINES = 28;
export const OPT_CONTINUATION_MAX_BYTES = 31;
export const OPT_TERMINFO_NAME = 37;

export const DATA_COLS = 1;
export const DATA_ROWS = 2;
export const DATA_CURSOR_X = 3;
export const DATA_CURSOR_Y = 4;
export const DATA_ACTIVE_SCREEN = 6;
export const DATA_TITLE = 12;
export const DATA_PWD = 13;
export const DATA_TOTAL_ROWS = 14;
export const DATA_SCROLLBACK_ROWS = 15;
export const DATA_COLOR_FOREGROUND = 18;
export const DATA_COLOR_BACKGROUND = 19;
export const DATA_COLOR_CURSOR = 20;
export const DATA_COLOR_PALETTE = 21;

export const SCREEN_PRIMARY = 0;
export const SCREEN_ALTERNATE = 1;

/** Default continuation retention so snapshot encode can capture unfinished VT. */
export const CONTINUATION_MAX_BYTES = 4096;
