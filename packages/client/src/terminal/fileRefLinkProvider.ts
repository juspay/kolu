import type { IBufferLine, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { type LineRef, type LineRefMatch, parseLineRefs } from "../ui/lineRef";

export interface FileRefLinkOpts {
  onActivate: (ref: LineRef, event: MouseEvent) => void;
}

const HAS_NON_ASCII = /[^\x00-\x7f]/;

interface CellRefMatch {
  ref: LineRef;
  text: string;
  startCol: number;
  endCol: number;
}

type ColumnOf = (strIndex: number) => number;

function cellColumnLookup(line: IBufferLine, text: string): ColumnOf {
  const colFor: number[] = [];
  let strIndex = 0;
  let endCol = 0;
  for (let col = 0; col < line.length && strIndex < text.length; col++) {
    const cell = line.getCell(col);
    if (!cell) break;
    const width = cell.getWidth();
    if (width === 0) continue;
    const chars = cell.getChars();
    const consumed = chars.length > 0 ? chars.length : 1;
    for (let k = 0; k < consumed && strIndex < text.length; k++) {
      colFor[strIndex] = col;
      strIndex++;
    }
    endCol = col + width;
  }
  return (at) => colFor[at] ?? endCol;
}

function cellRefsAt(terminal: Terminal, bufferLine: number): CellRefMatch[] {
  const lineObj = terminal.buffer.active.getLine(bufferLine);
  if (!lineObj) return [];
  const text = lineObj.translateToString(true);
  if (text.indexOf("/") < 0 && text.indexOf(".") < 0) return [];
  const matches = parseLineRefs(text);
  if (matches.length === 0) return [];
  const colOf: ColumnOf = HAS_NON_ASCII.test(text)
    ? cellColumnLookup(lineObj, text)
    : (at) => at;
  return matches.map((match: LineRefMatch) => ({
    ref: {
      path: match.path,
      startLine: match.startLine,
      endLine: match.endLine,
    },
    text: match.text,
    startCol: colOf(match.index),
    endCol: colOf(match.index + match.text.length),
  }));
}

export function createFileRefLinkProvider(
  terminal: Terminal,
  opts: FileRefLinkOpts,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const matches = cellRefsAt(terminal, bufferLineNumber - 1);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map((match) => ({
        range: {
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

export function fileRefAtCell(
  terminal: Terminal,
  col: number,
  bufferLine: number,
): LineRef | null {
  for (const match of cellRefsAt(terminal, bufferLine)) {
    if (col >= match.startCol && col < match.endCol) {
      return match.ref;
    }
  }
  return null;
}
