/** xterm.js link provider that linkifies `path:line[:col][-end]`
 *  references in terminal output. Parsing semantics + the regex live
 *  in `ui/lineRef.ts` — this module is just the xterm adapter:
 *  buffer-line → `parseLineRefs` → `ILink[]`. */

import type { ILink, ILinkProvider, IBufferLine, Terminal } from "@xterm/xterm";
import { type LineRef, type LineRefMatch, parseLineRefs } from "../ui/lineRef";

export interface FileRefLinkOpts {
  onActivate: (ref: LineRef, event: MouseEvent) => void;
}

/** A parsed ref plus its position in *cell* columns rather than JS string
 *  offsets. `parseLineRefs` reports UTF-16 string offsets, but xterm's hover
 *  range and the touch hit-test address the buffer by cell column — and the
 *  two diverge whenever a line holds wide (CJK, width-2) characters or
 *  combining marks (width-0). `startCol`/`endCol` are 0-based, half-open
 *  `[startCol, endCol)`. */
interface CellRefMatch {
  ref: LineRef;
  text: string;
  startCol: number;
  endCol: number;
}

/** Map a JS string offset (into `translateToString`'s output) to the buffer
 *  cell column it begins at. Built by walking the line's cells once: each
 *  cell contributes its `getChars()` to the string at a known column, and a
 *  width-2 cell is followed by a width-0 spacer cell that adds no characters.
 *
 *  The returned array has `text.length + 1` entries; `colFor[i]` is the cell
 *  column where string index `i` starts, and `colFor[text.length]` is the
 *  column one past the last character (so a half-open `[start, end)` string
 *  span maps to a half-open cell span). */
function buildStringToCellMap(line: IBufferLine, text: string): number[] {
  const colFor: number[] = [];
  let strIndex = 0;
  for (let col = 0; col < line.length && strIndex < text.length; col++) {
    const cell = line.getCell(col);
    if (!cell) break;
    const width = cell.getWidth();
    // Width-0 cells are the trailing half of a preceding wide glyph; they
    // hold no characters of their own, so they advance the column without
    // consuming any string index.
    if (width === 0) continue;
    const chars = cell.getChars();
    // An empty cell (`getChars() === ""`) still renders as a single space in
    // `translateToString`'s output, so it consumes one string char.
    const consumed = chars.length > 0 ? chars.length : 1;
    for (let k = 0; k < consumed && strIndex < text.length; k++) {
      colFor[strIndex] = col;
      strIndex++;
    }
  }
  // Any string indices past the walked cells (shouldn't happen for trimmed
  // text, but guards against a desync) collapse onto the final column.
  const lastCol = line.length;
  while (colFor.length <= text.length) colFor.push(lastCol);
  return colFor;
}

/** Parse the `path:line` references on a buffer line (0-based index), each
 *  carrying its position as a cell-column range. The one place both the hover
 *  provider and the touch hit-test read a buffer line, so they can never
 *  disagree on what is a link or where it sits. Returns [] for a missing line
 *  or one with no resolvable reference. */
function cellRefsAt(terminal: Terminal, bufferLine: number): CellRefMatch[] {
  const lineObj = terminal.buffer.active.getLine(bufferLine);
  if (!lineObj) return [];
  const text = lineObj.translateToString(true);
  // Cheap necessary condition: every match requires at least one `/`
  // (slash-containing branch) or one `.` (bare extension branch). Skipping the
  // regex on plain prompts is a meaningful win on a hot path that fires per
  // hover-cell. `:` alone is no longer sufficient since `:N` became optional.
  if (text.indexOf("/") < 0 && text.indexOf(".") < 0) return [];
  const matches = parseLineRefs(text);
  if (matches.length === 0) return [];
  // Only pay for the per-cell width walk when there's a non-ASCII char that
  // could make a string offset and a cell column diverge — the common all-
  // ASCII line keeps offset === column.
  const needsCellMap = /[^\x00-\x7f]/.test(text);
  const colFor = needsCellMap ? buildStringToCellMap(lineObj, text) : null;
  return matches.map((match: LineRefMatch) => {
    const start = colFor ? colFor[match.index] : match.index;
    const end = colFor
      ? colFor[match.index + match.text.length]
      : match.index + match.text.length;
    return {
      ref: {
        path: match.path,
        startLine: match.startLine,
        endLine: match.endLine,
      },
      text: match.text,
      startCol: start ?? match.index,
      endCol: end ?? match.index + match.text.length,
    };
  });
}

export function createFileRefLinkProvider(
  terminal: Terminal,
  opts: FileRefLinkOpts,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      // `bufferLineNumber` is xterm's 1-based row; `cellRefsAt` takes a 0-based
      // index into the active buffer (scrollback + viewport).
      const matches = cellRefsAt(terminal, bufferLineNumber - 1);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map((match) => ({
        range: {
          // xterm's link range is 1-based and inclusive on both ends; our
          // `[startCol, endCol)` cell span is 0-based half-open. `start.x` is
          // `startCol + 1`; `end.x` is `endCol` (the last covered column,
          // 1-based, is `endCol - 1 + 1`).
          start: { x: match.startCol + 1, y: bufferLineNumber },
          end: { x: match.endCol, y: bufferLineNumber },
        },
        text: match.text,
        activate: (event) => opts.onActivate(match.ref, event),
      }));
      callback(links);
    },
  };
}

/** Hit-test a `path:line` reference at a buffer cell — the touch counterpart
 *  to the hover link provider above. xterm's built-in link activation is
 *  mouse/hover-driven and never fires for a touch tap, so the mobile tap
 *  handler resolves the ref itself: it converts the tap to a (col, buffer-line)
 *  cell and asks here whether a reference covers it. Shares `cellRefsAt` with
 *  the provider, so a tap and a hover never disagree about what is a link.
 *
 *  `col` and `bufferLine` are 0-based xterm buffer indices. Returns the
 *  covering ref, or null for plain content (the tap should focus to type). */
export function fileRefAtCell(
  terminal: Terminal,
  col: number,
  bufferLine: number,
): LineRef | null {
  for (const match of cellRefsAt(terminal, bufferLine)) {
    // Cell range covers columns [startCol, endCol); the 0-based tap column
    // maps directly onto that span — and because both ends are now in cell
    // units, a wide-character path before/within the ref no longer shifts it.
    if (col >= match.startCol && col < match.endCol) {
      return match.ref;
    }
  }
  return null;
}
