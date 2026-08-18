/** Official Ghostty render-state read: update → cells/colors/cursor → clean. */

import {
  BUFFER_SIZE,
  COLOR_RGB_SIZE,
  GHOSTTY_INVALID_VALUE,
  GHOSTTY_NO_VALUE,
  GHOSTTY_SUCCESS,
  RS_CELL_DATA_BG_COLOR,
  RS_CELL_DATA_FG_COLOR,
  RS_CELL_DATA_GRAPHEMES_UTF8,
  RS_CELL_DATA_HAS_STYLING,
  RS_CELL_DATA_STYLE,
  RS_DATA_COLOR_BACKGROUND,
  RS_DATA_COLOR_FOREGROUND,
  RS_DATA_COLS,
  RS_DATA_CURSOR_VIEWPORT_HAS_VALUE,
  RS_DATA_CURSOR_VIEWPORT_X,
  RS_DATA_CURSOR_VIEWPORT_Y,
  RS_DATA_CURSOR_VISIBLE,
  RS_DATA_DIRTY,
  RS_DATA_ROW_ITERATOR,
  RS_DATA_ROWS,
  RS_DIRTY_FALSE,
  RS_DIRTY_FULL,
  RS_DIRTY_PARTIAL,
  RS_ROW_DATA_CELLS,
  SCROLL_VIEWPORT_BOTTOM,
  SCROLL_VIEWPORT_ROW,
  SCROLL_VIEWPORT_SIZE,
  STYLE_BOLD,
  STYLE_FAINT,
  STYLE_INVERSE,
  STYLE_ITALIC,
  STYLE_SIZE,
  STYLE_UNDERLINE,
} from "./constants.ts";
import { check, type Ffi } from "./ffi.ts";
import type { GhosttyExports } from "./load.ts";

export type RenderDirty = "false" | "partial" | "full";

export interface RenderRgb {
  r: number;
  g: number;
  b: number;
}

export interface RenderCell {
  x: number;
  y: number;
  text: string;
  fg: RenderRgb | null;
  bg: RenderRgb | null;
  bold: boolean;
  italic: boolean;
  faint: boolean;
  underline: boolean;
  inverse: boolean;
}

export interface RenderFrame {
  dirty: RenderDirty;
  cols: number;
  rows: number;
  background: RenderRgb;
  foreground: RenderRgb;
  cursor: { x: number; y: number; visible: boolean } | null;
  cells: RenderCell[];
}

export interface RenderState {
  update(): RenderDirty;
  clean(): void;
  readFrame(): RenderFrame;
  pinBottom(): void;
  pinRow(row: number): void;
  free(): void;
}

function dirtyName(n: number): RenderDirty {
  if (n === RS_DIRTY_FALSE) return "false";
  if (n === RS_DIRTY_PARTIAL) return "partial";
  if (n === RS_DIRTY_FULL) return "full";
  throw new Error(`@kolu/ghostty-kit: unknown render dirty ${n}`);
}

export function createRenderState(
  ffi: Ffi,
  wasm: { exports: GhosttyExports },
  getTerm: () => number,
): RenderState {
  const e = wasm.exports;
  const slot = ffi.allocOpaque();
  check("render_state_new", e.ghostty_render_state_new(0, slot));
  const state = ffi.takeOpaque(slot);

  const itSlot = ffi.allocOpaque();
  check("row_iterator_new", e.ghostty_render_state_row_iterator_new(0, itSlot));
  const iterator = ffi.takeOpaque(itSlot);

  const cellsSlot = ffi.allocOpaque();
  check("row_cells_new", e.ghostty_render_state_row_cells_new(0, cellsSlot));
  const cells = ffi.takeOpaque(cellsSlot);

  const utf8Cap = 64;
  const utf8 = ffi.allocBytes(utf8Cap);
  const buf = ffi.allocBytes(BUFFER_SIZE);
  const rgb = ffi.allocBytes(COLOR_RGB_SIZE);
  const style = ffi.allocBytes(STYLE_SIZE);
  const u16 = ffi.allocBytes(4);
  const i32 = ffi.allocBytes(4);
  const flag = ffi.allocBytes(1);
  const scroll = ffi.allocBytes(SCROLL_VIEWPORT_SIZE);
  const itStore = ffi.allocBytes(4);
  const cellsStore = ffi.allocBytes(4);

  function getI32(kind: number): number {
    check(`render_get(${kind})`, e.ghostty_render_state_get(state, kind, i32));
    return ffi.view().getInt32(i32, true);
  }

  function getU16(kind: number): number {
    check(`render_get(${kind})`, e.ghostty_render_state_get(state, kind, u16));
    return ffi.view().getUint16(u16, true);
  }

  function getBool(kind: number): boolean {
    check(`render_get(${kind})`, e.ghostty_render_state_get(state, kind, flag));
    return ffi.view().getUint8(flag) !== 0;
  }

  function getRgb(kind: number): RenderRgb {
    check(`render_get(${kind})`, e.ghostty_render_state_get(state, kind, rgb));
    return {
      r: ffi.view().getUint8(rgb),
      g: ffi.view().getUint8(rgb + 1),
      b: ffi.view().getUint8(rgb + 2),
    };
  }

  function cellRgb(kind: number): RenderRgb | null {
    const result = e.ghostty_render_state_row_cells_get(cells, kind, rgb);
    if (result === GHOSTTY_INVALID_VALUE || result === GHOSTTY_NO_VALUE) {
      return null;
    }
    if (result !== GHOSTTY_SUCCESS) return null;
    return {
      r: ffi.view().getUint8(rgb),
      g: ffi.view().getUint8(rgb + 1),
      b: ffi.view().getUint8(rgb + 2),
    };
  }

  function cellText(): string {
    ffi.setU32(buf, utf8);
    ffi.setU32(buf + 4, utf8Cap);
    ffi.setU32(buf + 8, 0);
    const result = e.ghostty_render_state_row_cells_get(
      cells,
      RS_CELL_DATA_GRAPHEMES_UTF8,
      buf,
    );
    if (result !== GHOSTTY_SUCCESS) return "";
    const len = ffi.u32(buf + 8);
    if (len === 0) return "";
    return ffi.readUtf8(utf8, len);
  }

  function cellStyle(): {
    bold: boolean;
    italic: boolean;
    faint: boolean;
    underline: boolean;
    inverse: boolean;
  } {
    const none = {
      bold: false,
      italic: false,
      faint: false,
      underline: false,
      inverse: false,
    };
    check(
      "cell has_styling",
      e.ghostty_render_state_row_cells_get(
        cells,
        RS_CELL_DATA_HAS_STYLING,
        flag,
      ),
    );
    if (ffi.view().getUint8(flag) === 0) return none;
    new Uint8Array(ffi.memory(), style, STYLE_SIZE).fill(0);
    ffi.setU32(style, STYLE_SIZE);
    const result = e.ghostty_render_state_row_cells_get(
      cells,
      RS_CELL_DATA_STYLE,
      style,
    );
    if (result !== GHOSTTY_SUCCESS) return none;
    const v = ffi.view();
    return {
      bold: v.getUint8(style + STYLE_BOLD) !== 0,
      italic: v.getUint8(style + STYLE_ITALIC) !== 0,
      faint: v.getUint8(style + STYLE_FAINT) !== 0,
      inverse: v.getUint8(style + STYLE_INVERSE) !== 0,
      underline: v.getInt32(style + STYLE_UNDERLINE, true) !== 0,
    };
  }

  return {
    update() {
      check(
        "render_state_update",
        e.ghostty_render_state_update(state, getTerm()),
      );
      return dirtyName(getI32(RS_DATA_DIRTY));
    },
    clean() {
      check("render_state_clean", e.ghostty_render_state_clean(state));
    },
    readFrame() {
      const dirty = dirtyName(getI32(RS_DATA_DIRTY));
      const cols = getU16(RS_DATA_COLS);
      const rows = getU16(RS_DATA_ROWS);
      const background = getRgb(RS_DATA_COLOR_BACKGROUND);
      const foreground = getRgb(RS_DATA_COLOR_FOREGROUND);
      let cursor: RenderFrame["cursor"] = null;
      if (getBool(RS_DATA_CURSOR_VIEWPORT_HAS_VALUE)) {
        cursor = {
          x: getU16(RS_DATA_CURSOR_VIEWPORT_X),
          y: getU16(RS_DATA_CURSOR_VIEWPORT_Y),
          visible: getBool(RS_DATA_CURSOR_VISIBLE),
        };
      }
      ffi.setU32(itStore, iterator);
      check(
        "row_iterator",
        e.ghostty_render_state_get(state, RS_DATA_ROW_ITERATOR, itStore),
      );
      const out: RenderCell[] = [];
      let y = 0;
      while (e.ghostty_render_state_row_iterator_next(iterator)) {
        ffi.setU32(cellsStore, cells);
        check(
          "row_cells",
          e.ghostty_render_state_row_get(
            iterator,
            RS_ROW_DATA_CELLS,
            cellsStore,
          ),
        );
        let x = 0;
        while (e.ghostty_render_state_row_cells_next(cells)) {
          const text = cellText();
          if (text.length > 0) {
            out.push({
              x,
              y,
              text,
              fg: cellRgb(RS_CELL_DATA_FG_COLOR),
              bg: cellRgb(RS_CELL_DATA_BG_COLOR),
              ...cellStyle(),
            });
          }
          x += 1;
        }
        y += 1;
      }
      return {
        dirty,
        cols,
        rows,
        background,
        foreground,
        cursor,
        cells: out,
      };
    },
    pinBottom() {
      new Uint8Array(ffi.memory(), scroll, SCROLL_VIEWPORT_SIZE).fill(0);
      ffi.setU32(scroll, SCROLL_VIEWPORT_BOTTOM);
      e.ghostty_terminal_scroll_viewport(getTerm(), scroll);
    },
    pinRow(row) {
      new Uint8Array(ffi.memory(), scroll, SCROLL_VIEWPORT_SIZE).fill(0);
      ffi.setU32(scroll, SCROLL_VIEWPORT_ROW);
      ffi.setU32(scroll + 8, Math.max(0, row));
      e.ghostty_terminal_scroll_viewport(getTerm(), scroll);
    },
    free() {
      e.ghostty_render_state_row_cells_free(cells);
      e.ghostty_render_state_row_iterator_free(iterator);
      e.ghostty_render_state_free(state);
      ffi.freeBytes(utf8, utf8Cap);
      ffi.freeBytes(buf, BUFFER_SIZE);
      ffi.freeBytes(rgb, COLOR_RGB_SIZE);
      ffi.freeBytes(style, STYLE_SIZE);
      ffi.freeBytes(u16, 4);
      ffi.freeBytes(i32, 4);
      ffi.freeBytes(flag, 1);
      ffi.freeBytes(scroll, SCROLL_VIEWPORT_SIZE);
      ffi.freeBytes(itStore, 4);
      ffi.freeBytes(cellsStore, 4);
    },
  };
}
