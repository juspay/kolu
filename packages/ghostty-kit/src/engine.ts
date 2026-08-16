/** The shipped VT engine: official wasm load + write/resize/format/snapshot/OSC. */

import {
  CONTINUATION_MAX_BYTES,
  DATA_ACTIVE_SCREEN,
  DATA_CURSOR_X,
  DATA_CURSOR_Y,
  DATA_PWD,
  DATA_SCROLLBACK_ROWS,
  DATA_TITLE,
  DATA_TOTAL_ROWS,
  FORMAT_HTML,
  FORMAT_PLAIN,
  FORMAT_VT,
  GRID_REF_SIZE,
  POINT_SIZE,
  POINT_TAG_SCREEN,
  POINT_TAG_VIEWPORT,
  SELECTION_SIZE,
  OPT_CONTINUATION_MAX_BYTES,
  OPT_PWD_CHANGED,
  OPT_SCROLLBACK_MAX_LINES,
  OPT_TITLE_CHANGED,
  OPT_USERDATA,
  OPT_WRITE_PTY,
} from "./constants.ts";
import { check, Ffi } from "./ffi.ts";
import { installHostCallbacks, loadGhostty } from "./load.ts";
import { parseVtStyled, type StyledLine } from "./styled.ts";
import {
  applyCursorKeyMode,
  containsRis,
  scanOsc52,
  scanOsc633E,
  takeCompleteVt,
} from "./vtSpan.ts";

export type ScreenExtent =
  | { kind: "full" }
  | { kind: "range"; startLine?: number; endLine?: number }
  | { kind: "tail"; lines: number }
  | { kind: "viewport" };

export interface EngineOptions {
  cols: number;
  rows: number;
  /** Soft cap on scrollback lines (Ghostty `SCROLLBACK_MAX_LINES`). */
  scrollback?: number;
  onWritePty?: (bytes: Uint8Array) => void;
  onTitle?: (title: string) => void;
  onPwd?: (pwd: string) => void;
  onCommandRun?: (command: string) => void;
  onOsc52?: (selection: string, payload: string) => void;
}

export interface Engine {
  readonly cols: number;
  readonly rows: number;
  write(data: string | Uint8Array): void;
  resize(
    cols: number,
    rows: number,
    cellWidthPx?: number,
    cellHeightPx?: number,
  ): void;
  formatPlain(opts?: { unwrap?: boolean; trim?: boolean }): string;
  formatVt(opts?: { unwrap?: boolean; trim?: boolean }): string;
  formatHtml(opts?: { unwrap?: boolean; trim?: boolean }): string;
  /** Visual rows of column-aligned SGR runs (official FORMAT_VT). */
  styledLines(extent?: ScreenExtent): StyledLine[];
  encodeSnapshot(): Uint8Array;
  restoreSnapshot(bytes: Uint8Array): void;
  getScreenText(extent?: ScreenExtent): string;
  /** Recent-window VT for attach: last `scrollback + rows` visual lines. */
  formatRecentVt(scrollbackLines: number): string;
  /** Older-history VT slice: visual rows `[start, end]` inclusive, 0 = oldest. */
  formatRangeVt(start: number, end: number): string;
  getTitle(): string;
  getPwd(): string;
  totalRows(): number;
  scrollbackRows(): number;
  cursor(): { x: number; y: number };
  /** Official Ghostty terminal display width of a code point (0, 1, or 2). */
  cellWidth(cp: number): number;
  /** True while DECSET 1 (DECCKM / application cursor keys) is on. */
  applicationCursor(): boolean;
  /** Visual row count (unwrap:false FORMAT_VT), the history-index axis. */
  visualLineCount(): number;
  /** Bytes the last wasm format_alloc produced. 0 if nothing has formatted. */
  lastFormatBytes(): number;
  activeScreen(): number;
  /** Absolute-line origin (lines discarded by reset). */
  baseLine(): number;
  reflowEpoch(): number;
  bumpReflow(): void;
  reanchorIfReset(): void;
  free(): void;
}

type HostSlot = {
  onWritePty?: (bytes: Uint8Array) => void;
  onTitle?: (title: string) => void;
  onPwd?: (pwd: string) => void;
  ffi: Ffi;
  term: number;
};

const hosts = new Map<number, HostSlot>();
let nextUserdata = 1;
let hostInstalled = false;

function ensureHost(ffi: Ffi): void {
  if (hostInstalled) return;
  installHostCallbacks({
    writePty: (_term, userdata, dataPtr, len) => {
      const slot = hosts.get(userdata);
      if (!slot?.onWritePty || len <= 0) return;
      slot.onWritePty(ffi.readBytes(dataPtr, len));
    },
    notify2: (_term, userdata) => {
      const slot = hosts.get(userdata);
      if (!slot) return;
      slot.onTitle?.(slot.ffi.getString(slot.term, DATA_TITLE));
      slot.onPwd?.(slot.ffi.getString(slot.term, DATA_PWD));
    },
  });
  hostInstalled = true;
}

const FORMAT_OPTS_SIZE = 40;
const FORMAT_EXTRA_SIZE = 24;

export function createEngine(opts: EngineOptions): Engine {
  const wasm = loadGhostty();
  const ffi = new Ffi(wasm);
  ensureHost(ffi);

  const out = ffi.allocOpaque();
  check(
    "terminal_new",
    wasm.exports.ghostty_terminal_new(0, out, opts.cols, opts.rows),
  );
  let term = ffi.u32(out);

  const userdata = nextUserdata++;
  const slot: HostSlot = {
    onWritePty: opts.onWritePty,
    onTitle: opts.onTitle,
    onPwd: opts.onPwd,
    ffi,
    term,
  };
  hosts.set(userdata, slot);

  const ud = ffi.allocUsize();
  ffi.setU32(ud, userdata);
  check(
    "set userdata",
    wasm.exports.ghostty_terminal_set(term, OPT_USERDATA, ud),
  );
  check(
    "set write_pty",
    wasm.exports.ghostty_terminal_set(term, OPT_WRITE_PTY, wasm.f4Index),
  );
  check(
    "set title_changed",
    wasm.exports.ghostty_terminal_set(term, OPT_TITLE_CHANGED, wasm.f2Index),
  );
  check(
    "set pwd_changed",
    wasm.exports.ghostty_terminal_set(term, OPT_PWD_CHANGED, wasm.f2Index),
  );

  const cont = ffi.allocUsize();
  ffi.setU32(cont, CONTINUATION_MAX_BYTES);
  check(
    "set continuation",
    wasm.exports.ghostty_terminal_set(term, OPT_CONTINUATION_MAX_BYTES, cont),
  );

  if (opts.scrollback !== undefined) {
    const sb = ffi.allocUsize();
    ffi.setU32(sb, opts.scrollback);
    check(
      "set scrollback",
      wasm.exports.ghostty_terminal_set(term, OPT_SCROLLBACK_MAX_LINES, sb),
    );
  }

  let cols = opts.cols;
  let rows = opts.rows;
  let origin = 0;
  let epoch = 0;
  let lastTotal = rows;
  let oscTail = "";
  let applicationCursor = false;
  let visualCount: number | undefined;
  let lastFmtBytes = 0;
  let cachedPlain: string | undefined;
  let cachedVt: string | undefined;
  let cachedStyled: StyledLine[] | undefined;

  function invalidate(): void {
    cachedPlain = undefined;
    cachedVt = undefined;
    cachedStyled = undefined;
  }

  function bindTerm(next: number): void {
    term = next;
    slot.term = next;
  }

  function format(
    emit: number,
    unwrap = true,
    trim = true,
    selectionPtr = 0,
  ): string {
    const opt = ffi.allocBytes(FORMAT_OPTS_SIZE);
    try {
      new Uint8Array(ffi.memory(), opt, FORMAT_OPTS_SIZE).fill(0);
      ffi.setU32(opt, FORMAT_OPTS_SIZE);
      ffi.setU32(opt + 4, emit);
      ffi.setU8(opt + 8, unwrap ? 1 : 0);
      ffi.setU8(opt + 9, trim ? 1 : 0);
      ffi.setU32(opt + 12, FORMAT_EXTRA_SIZE);
      if (selectionPtr !== 0) ffi.setU32(opt + 36, selectionPtr);
      const fmtOut = ffi.allocOpaque();
      check(
        "formatter_new",
        wasm.exports.ghostty_formatter_terminal_new(0, fmtOut, term, opt),
      );
      const fmt = ffi.u32(fmtOut);
      try {
        const ptrOut = ffi.allocOpaque();
        const lenOut = ffi.allocUsize();
        check(
          "format_alloc",
          wasm.exports.ghostty_formatter_format_alloc(fmt, 0, ptrOut, lenOut),
        );
        const ptr = ffi.u32(ptrOut);
        const len = ffi.u32(lenOut);
        lastFmtBytes = len;
        const text = len === 0 ? "" : ffi.readUtf8(ptr, len);
        if (ptr !== 0) wasm.exports.ghostty_free(0, ptr, len);
        return text;
      } finally {
        wasm.exports.ghostty_formatter_free(fmt);
      }
    } finally {
      ffi.freeBytes(opt, FORMAT_OPTS_SIZE);
    }
  }

  function gridRefAt(tag: number, x: number, y: number): number {
    const point = ffi.allocBytes(POINT_SIZE);
    const ref = ffi.allocBytes(GRID_REF_SIZE);
    try {
      new Uint8Array(ffi.memory(), point, POINT_SIZE).fill(0);
      new Uint8Array(ffi.memory(), ref, GRID_REF_SIZE).fill(0);
      ffi.setU32(point, tag);
      ffi.view().setUint16(point + 8, x, true);
      ffi.view().setUint32(point + 12, y, true);
      check(
        "grid_ref",
        wasm.exports.ghostty_terminal_grid_ref(term, point, ref),
      );
      return ref;
    } finally {
      ffi.freeBytes(point, POINT_SIZE);
    }
  }

  function formatSelection(
    emit: number,
    unwrap: boolean,
    trim: boolean,
    startRef: number,
    endRef: number,
  ): string {
    const sel = ffi.allocBytes(SELECTION_SIZE);
    try {
      new Uint8Array(ffi.memory(), sel, SELECTION_SIZE).fill(0);
      ffi.setU32(sel, SELECTION_SIZE);
      new Uint8Array(ffi.memory(), sel + 4, GRID_REF_SIZE).set(
        new Uint8Array(ffi.memory(), startRef, GRID_REF_SIZE),
      );
      new Uint8Array(ffi.memory(), sel + 16, GRID_REF_SIZE).set(
        new Uint8Array(ffi.memory(), endRef, GRID_REF_SIZE),
      );
      return format(emit, unwrap, trim, sel);
    } finally {
      ffi.freeBytes(sel, SELECTION_SIZE);
    }
  }

  function formatExtent(
    emit: number,
    unwrap: boolean,
    trim: boolean,
    extent: ScreenExtent,
  ): string {
    if (extent.kind === "full") return format(emit, unwrap, trim);
    const lastCol = Math.max(0, cols - 1);
    if (extent.kind === "viewport") {
      const start = gridRefAt(POINT_TAG_VIEWPORT, 0, 0);
      const end = gridRefAt(POINT_TAG_VIEWPORT, lastCol, Math.max(0, rows - 1));
      try {
        return formatSelection(emit, unwrap, trim, start, end);
      } finally {
        ffi.freeBytes(start, GRID_REF_SIZE);
        ffi.freeBytes(end, GRID_REF_SIZE);
      }
    }
    const total = ffi.getU32(term, DATA_TOTAL_ROWS);
    let startY: number;
    let endY: number;
    if (extent.kind === "tail") {
      const n = Math.max(0, extent.lines);
      if (n === 0 || total === 0) return "";
      startY = Math.max(0, total - n);
      endY = Math.max(0, total - 1);
    } else {
      startY = Math.max(0, extent.startLine ?? 0);
      const endEx = Math.min(total, extent.endLine ?? total);
      if (endEx <= startY) return "";
      endY = endEx - 1;
    }
    const start = gridRefAt(POINT_TAG_SCREEN, 0, startY);
    const end = gridRefAt(POINT_TAG_SCREEN, lastCol, endY);
    try {
      return formatSelection(emit, unwrap, trim, start, end);
    } finally {
      ffi.freeBytes(start, GRID_REF_SIZE);
      ffi.freeBytes(end, GRID_REF_SIZE);
    }
  }

  function linesOf(text: string): string[] {
    if (text.length === 0) return [];
    return text.split(/\r?\n/);
  }

  function sliceLines(all: string[], extent: ScreenExtent): string {
    switch (extent.kind) {
      case "full":
        return all.join("\n");
      case "range": {
        const start = Math.max(0, extent.startLine ?? 0);
        const end = Math.min(all.length, extent.endLine ?? all.length);
        return all.slice(start, end).join("\n");
      }
      case "tail": {
        const n = Math.max(0, extent.lines);
        return all.slice(Math.max(0, all.length - n)).join("\n");
      }
      case "viewport":
        return all.slice(Math.max(0, all.length - rows)).join("\n");
    }
  }

  function sliceStyled(all: StyledLine[], extent: ScreenExtent): StyledLine[] {
    switch (extent.kind) {
      case "full":
        return all;
      case "range": {
        const start = Math.max(0, extent.startLine ?? 0);
        const end = Math.min(all.length, extent.endLine ?? all.length);
        return all.slice(start, end);
      }
      case "tail": {
        const n = Math.max(0, extent.lines);
        return all.slice(Math.max(0, all.length - n));
      }
      case "viewport": {
        if (all.length >= rows) return all.slice(all.length - rows);
        const pad = rows - all.length;
        const empty: StyledLine[] = Array.from({ length: pad }, () => ({
          runs: [],
        }));
        return [...all, ...empty];
      }
    }
  }

  function allStyled(): StyledLine[] {
    if (cachedStyled !== undefined) return cachedStyled;
    // unwrap=false / trim=true is the ONE visual row list: paint, the
    // xterm shim, and hit-testing all slice this. trim=false keeps
    // trailing empty rows and shifts every Y by that padding.
    const vt = format(FORMAT_VT, false, true);
    cachedStyled = parseVtStyled(vt, (cp) =>
      wasm.exports.ghostty_unicode_codepoint_width(cp),
    );
    return cachedStyled;
  }

  return {
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    write(data) {
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data;
      const text = new TextDecoder().decode(bytes);
      const spanned = takeCompleteVt(oscTail, text);
      oscTail = spanned.leftover;
      if (opts.onCommandRun) scanOsc633E(spanned.complete, opts.onCommandRun);
      if (opts.onOsc52) scanOsc52(spanned.complete, opts.onOsc52);
      applicationCursor = applyCursorKeyMode(
        spanned.complete,
        applicationCursor,
      );
      const ptr = ffi.writeBytes(bytes);
      try {
        wasm.exports.ghostty_terminal_vt_write(term, ptr, bytes.length);
      } finally {
        ffi.freeBytes(ptr, bytes.length);
      }
      const total = ffi.getU32(term, DATA_TOTAL_ROWS);
      const ris = containsRis(spanned.complete);
      if (total < lastTotal) {
        if (ris) {
          origin += lastTotal;
          epoch += 1;
          visualCount = undefined;
        } else {
          origin += lastTotal - total;
        }
      }
      if (visualCount !== undefined && !ris) {
        visualCount += total - lastTotal;
      }
      lastTotal = total;
      invalidate();
    },
    resize(nextCols, nextRows, cellWidthPx = 8, cellHeightPx = 16) {
      if (nextCols === cols && nextRows === rows) return;
      const widthChanged = nextCols !== cols;
      check(
        "resize",
        wasm.exports.ghostty_terminal_resize(
          term,
          nextCols,
          nextRows,
          cellWidthPx,
          cellHeightPx,
        ),
      );
      cols = nextCols;
      rows = nextRows;
      lastTotal = ffi.getU32(term, DATA_TOTAL_ROWS);
      if (widthChanged) {
        epoch += 1;
        visualCount = undefined;
      }
      invalidate();
    },
    formatPlain(o) {
      if (o === undefined && cachedPlain !== undefined) return cachedPlain;
      const text = format(FORMAT_PLAIN, o?.unwrap ?? true, o?.trim ?? true);
      if (o === undefined) cachedPlain = text;
      return text;
    },
    formatVt(o) {
      if (o === undefined && cachedVt !== undefined) return cachedVt;
      const text = format(FORMAT_VT, o?.unwrap ?? true, o?.trim ?? true);
      if (o === undefined) cachedVt = text;
      return text;
    },
    formatHtml(o) {
      return format(FORMAT_HTML, o?.unwrap ?? true, o?.trim ?? true);
    },
    styledLines(extent) {
      const want = extent ?? { kind: "full" };
      if (want.kind === "full") return allStyled();
      const vt = formatExtent(FORMAT_VT, false, true, want);
      const parsed = parseVtStyled(vt, (cp) =>
        wasm.exports.ghostty_unicode_codepoint_width(cp),
      );
      if (want.kind !== "viewport") return parsed;
      return sliceStyled(parsed, { kind: "viewport" });
    },
    encodeSnapshot() {
      const ptrOut = ffi.allocOpaque();
      const lenOut = ffi.allocUsize();
      check(
        "snapshot_encode",
        wasm.exports.ghostty_snapshot_encode_alloc(term, 0, ptrOut, lenOut),
      );
      const ptr = ffi.u32(ptrOut);
      const len = ffi.u32(lenOut);
      const bytes = ffi.readBytes(ptr, len);
      if (ptr !== 0) wasm.exports.ghostty_free(0, ptr, len);
      return bytes;
    },
    restoreSnapshot(bytes) {
      const src = ffi.writeBytes(bytes);
      const decOut = ffi.allocOpaque();
      check(
        "decoder_new",
        wasm.exports.ghostty_snapshot_decoder_new_buf(
          0,
          decOut,
          src,
          bytes.length,
        ),
      );
      const decoder = ffi.u32(decOut);
      const termOut = ffi.allocOpaque();
      try {
        check(
          "decoder_decode",
          wasm.exports.ghostty_snapshot_decoder_decode(decoder, termOut),
        );
        const restored = ffi.u32(termOut);
        wasm.exports.ghostty_terminal_free(term);
        bindTerm(restored);
      } finally {
        wasm.exports.ghostty_snapshot_decoder_free(decoder);
        ffi.freeBytes(src, bytes.length);
      }
      lastTotal = ffi.getU32(term, DATA_TOTAL_ROWS);
      visualCount = undefined;
      invalidate();
    },
    getScreenText(extent) {
      const all = linesOf(this.formatPlain());
      return sliceLines(all, extent ?? { kind: "full" });
    },
    formatRecentVt(scrollbackLines) {
      const all = linesOf(this.formatVt({ unwrap: false, trim: true }));
      const keep = Math.max(0, scrollbackLines + rows);
      return all.slice(Math.max(0, all.length - keep)).join("\r\n");
    },
    formatRangeVt(start, end) {
      const all = linesOf(this.formatVt({ unwrap: false, trim: true }));
      const s = Math.max(0, start);
      const e = Math.min(all.length - 1, end);
      if (e < s) return "";
      return all.slice(s, e + 1).join("\r\n");
    },
    getTitle() {
      return ffi.getString(term, DATA_TITLE);
    },
    getPwd() {
      return ffi.getString(term, DATA_PWD);
    },
    totalRows() {
      return ffi.getU32(term, DATA_TOTAL_ROWS);
    },
    scrollbackRows() {
      return ffi.getU32(term, DATA_SCROLLBACK_ROWS);
    },
    cursor() {
      return {
        x: ffi.getU32(term, DATA_CURSOR_X),
        y: ffi.getU32(term, DATA_CURSOR_Y),
      };
    },
    cellWidth(cp) {
      return wasm.exports.ghostty_unicode_codepoint_width(cp);
    },
    applicationCursor() {
      return applicationCursor;
    },
    visualLineCount() {
      if (visualCount === undefined) {
        visualCount = linesOf(format(FORMAT_VT, false, true)).length;
      }
      return visualCount;
    },
    lastFormatBytes() {
      return lastFmtBytes;
    },
    activeScreen() {
      return ffi.getU32(term, DATA_ACTIVE_SCREEN);
    },
    baseLine() {
      return origin;
    },
    reflowEpoch() {
      return epoch;
    },
    bumpReflow() {
      epoch += 1;
    },
    reanchorIfReset() {
      const total = ffi.getU32(term, DATA_TOTAL_ROWS);
      if (total < lastTotal) {
        origin += lastTotal - total;
        lastTotal = total;
      }
    },
    free() {
      hosts.delete(userdata);
      wasm.exports.ghostty_terminal_free(term);
    },
  };
}
