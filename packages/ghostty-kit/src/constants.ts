/** Result / option / data tag numbers from libghostty-vt `types.h` + `terminal.h`.
 *  These are ABI constants of the pinned wasm, not a second engine. */

export const GHOSTTY_SUCCESS = 0;
export const GHOSTTY_INVALID_VALUE = -2;
export const GHOSTTY_NO_VALUE = -4;

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

/** GhosttyPoint.tag — viewport is the live screen; screen is history+active. */
export const POINT_TAG_VIEWPORT = 1;
export const POINT_TAG_SCREEN = 2;

export const POINT_SIZE = 24;
export const GRID_REF_SIZE = 12;
export const SELECTION_SIZE = 32;

export const RS_DIRTY_FALSE = 0;
export const RS_DIRTY_PARTIAL = 1;
export const RS_DIRTY_FULL = 2;

export const RS_DATA_COLS = 1;
export const RS_DATA_ROWS = 2;
export const RS_DATA_DIRTY = 3;
export const RS_DATA_ROW_ITERATOR = 4;
export const RS_DATA_COLOR_BACKGROUND = 5;
export const RS_DATA_COLOR_FOREGROUND = 6;
export const RS_DATA_CURSOR_VISIBLE = 11;
export const RS_DATA_CURSOR_VIEWPORT_HAS_VALUE = 14;
export const RS_DATA_CURSOR_VIEWPORT_X = 15;
export const RS_DATA_CURSOR_VIEWPORT_Y = 16;

export const RS_ROW_DATA_CELLS = 3;

export const RS_CELL_DATA_STYLE = 2;
export const RS_CELL_DATA_BG_COLOR = 5;
export const RS_CELL_DATA_FG_COLOR = 6;
export const RS_CELL_DATA_HAS_STYLING = 8;
export const RS_CELL_DATA_GRAPHEMES_UTF8 = 9;

export const STYLE_SIZE = 72;
export const STYLE_BOLD = 56;
export const STYLE_ITALIC = 57;
export const STYLE_FAINT = 58;
export const STYLE_UNDERLINE = 64;
export const STYLE_INVERSE = 60;

export const SCROLL_VIEWPORT_BOTTOM = 1;
export const SCROLL_VIEWPORT_ROW = 3;
export const SCROLL_VIEWPORT_SIZE = 24;

export const BUFFER_SIZE = 12;
export const COLOR_RGB_SIZE = 3;
