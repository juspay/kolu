import type { IBufferCell, IBufferLine, ILink, Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  createFileRefLinkProvider,
  fileRefAtCell,
} from "./fileRefLinkProvider";

/** Build a fake xterm buffer line from a list of cells, each `[chars, width]`.
 *  A width-2 cell must be followed by a width-0 spacer cell with empty chars,
 *  exactly as xterm stores wide glyphs — so the test exercises the same shape
 *  `buildStringToCellMap` walks. `translateToString(true)` concatenates the
 *  cell chars (empty cells render as a single space) and trims the right. */
function fakeLine(cells: [string, number][]): IBufferLine {
  const line = {
    length: cells.length,
    isWrapped: false,
    getCell(x: number): IBufferCell | undefined {
      const c = cells[x];
      if (!c) return undefined;
      return {
        getChars: () => c[0],
        getWidth: () => c[1],
      } as unknown as IBufferCell;
    },
    translateToString(trimRight?: boolean): string {
      // xterm emits no character for a width-0 spacer cell (the trailing half
      // of a wide glyph); a genuinely empty width>0 cell renders as a space.
      const s = cells
        .filter(([, width]) => width > 0)
        .map(([chars]) => (chars.length > 0 ? chars : " "))
        .join("");
      return trimRight ? s.replace(/\s+$/, "") : s;
    },
  };
  return line as unknown as IBufferLine;
}

/** Wrap a single fake line as a one-line terminal. */
function fakeTerminal(line: IBufferLine): Terminal {
  return {
    buffer: {
      active: { getLine: (y: number) => (y === 0 ? line : undefined) },
    },
  } as unknown as Terminal;
}

/** Render a JS string to a cell list, expanding wide (CJK) chars into a
 *  width-2 cell + a width-0 spacer. `wide` decides which chars are width-2. */
function cellsFor(
  s: string,
  wide: (ch: string) => boolean,
): [string, number][] {
  const cells: [string, number][] = [];
  for (const ch of s) {
    if (wide(ch)) {
      cells.push([ch, 2]);
      cells.push(["", 0]);
    } else {
      cells.push([ch, 1]);
    }
  }
  return cells;
}

const isCjk = (ch: string) => /[　-鿿＀-￯]/u.test(ch);

describe("fileRefLinkProvider cell geometry", () => {
  it("maps an all-ASCII ref directly (offset === column)", () => {
    const text = "see src/foo.ts:42 now";
    const line = fakeLine(cellsFor(text, () => false));
    const term = fakeTerminal(line);
    let links: ILink[] | undefined;
    createFileRefLinkProvider(term, { onActivate: () => {} }).provideLinks(
      1,
      (l) => {
        links = l;
      },
    );
    expect(links).toHaveLength(1);
    const idx = text.indexOf("src/");
    // 1-based start, inclusive end.
    expect(links?.[0]?.range.start.x).toBe(idx + 1);
    expect(links?.[0]?.range.end.x).toBe(idx + "src/foo.ts:42".length);
  });

  it("offsets the link range past a leading wide (CJK) prefix", () => {
    // Two CJK chars (`日本`) occupy 4 cells but only 2 string offsets. The ref
    // that follows must be shifted by the extra 2 cells, not the 2 offsets.
    const text = "日本 src/foo.ts:7";
    const line = fakeLine(cellsFor(text, isCjk));
    const term = fakeTerminal(line);
    let links: ILink[] | undefined;
    createFileRefLinkProvider(term, { onActivate: () => {} }).provideLinks(
      1,
      (l) => {
        links = l;
      },
    );
    expect(links).toHaveLength(1);
    // Cell layout: 日(0-1) 本(2-3) space(4) s(5)... so `src/...` starts at
    // cell column 5 → 1-based start.x === 6.
    expect(links?.[0]?.range.start.x).toBe(6);
    expect(links?.[0]?.text).toBe("src/foo.ts:7");
  });

  it("hit-tests a tap on a CJK-named ref by cell column", () => {
    // `日本語/メモ.txt:7` — every name char is wide. A tap landing on a cell
    // inside the ref must resolve; the string-offset math would have placed
    // the span half as wide and missed the tail.
    const text = "日本語/メモ.txt:7";
    const line = fakeLine(cellsFor(text, isCjk));
    const term = fakeTerminal(line);
    // The whole line is the ref. Its last cell column is length-1.
    const lastCol = line.length - 1;
    const hit = fileRefAtCell(term, lastCol, 0);
    expect(hit?.path).toBe("日本語/メモ.txt");
    expect(hit?.startLine).toBe(7);
    // A column past the ref's wide span resolves nothing.
    expect(fileRefAtCell(term, line.length + 5, 0)).toBeNull();
  });

  it("keeps the tap span correct for an ASCII ref after a wide prefix", () => {
    const text = "メモ src/a.ts";
    const line = fakeLine(cellsFor(text, isCjk));
    const term = fakeTerminal(line);
    // `メモ ` is 2 wide chars (4 cells) + a space (1 cell) = 5 cells, so the
    // ref starts at cell column 5. A tap on column 5 must hit; column 4 (the
    // space) must not.
    expect(fileRefAtCell(term, 5, 0)?.path).toBe("src/a.ts");
    expect(fileRefAtCell(term, 4, 0)).toBeNull();
  });
});
