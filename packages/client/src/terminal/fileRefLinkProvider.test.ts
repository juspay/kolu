import type { IBufferCell, IBufferLine, ILink, Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  createFileRefLinkProvider,
  fileRefAtCell,
} from "./fileRefLinkProvider";

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
      const s = cells
        .filter(([, width]) => width > 0)
        .map(([chars]) => (chars.length > 0 ? chars : " "))
        .join("");
      return trimRight ? s.replace(/\s+$/, "") : s;
    },
  };
  return line as unknown as IBufferLine;
}

function fakeTerminal(line: IBufferLine): Terminal {
  return {
    buffer: {
      active: { getLine: (y: number) => (y === 0 ? line : undefined) },
    },
  } as unknown as Terminal;
}

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
    expect(links?.[0]?.range.start.x).toBe(idx + 1);
    expect(links?.[0]?.range.end.x).toBe(idx + "src/foo.ts:42".length);
  });

  it("offsets the link range past a leading wide (CJK) prefix", () => {
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
    expect(links?.[0]?.range.start.x).toBe(6);
    expect(links?.[0]?.text).toBe("src/foo.ts:7");
  });

  it("hit-tests a tap on a CJK-named ref by cell column", () => {
    const text = "日本語/メモ.txt:7";
    const line = fakeLine(cellsFor(text, isCjk));
    const term = fakeTerminal(line);
    const lastCol = line.length - 1;
    const hit = fileRefAtCell(term, lastCol, 0);
    expect(hit?.path).toBe("日本語/メモ.txt");
    expect(hit?.startLine).toBe(7);
    expect(fileRefAtCell(term, line.length + 5, 0)).toBeNull();
  });

  it("stops the link end at the visible ref end, not the padded row width", () => {
    const text = "メモ/語.ts:3";
    const refCells = cellsFor(text, isCjk);
    const padded: [string, number][] = [
      ...refCells,
      ...Array.from({ length: 8 }, () => ["", 1] as [string, number]),
    ];
    const line = fakeLine(padded);
    const term = fakeTerminal(line);
    let links: ILink[] | undefined;
    createFileRefLinkProvider(term, { onActivate: () => {} }).provideLinks(
      1,
      (l) => {
        links = l;
      },
    );
    expect(links).toHaveLength(1);
    expect(links?.[0]?.range.end.x).toBe(12);
    expect(fileRefAtCell(term, 12, 0)).toBeNull();
    expect(fileRefAtCell(term, 11, 0)?.path).toBe("メモ/語.ts");
  });

  it("keeps the tap span correct for an ASCII ref after a wide prefix", () => {
    const text = "メモ src/a.ts";
    const line = fakeLine(cellsFor(text, isCjk));
    const term = fakeTerminal(line);
    expect(fileRefAtCell(term, 5, 0)?.path).toBe("src/a.ts");
    expect(fileRefAtCell(term, 4, 0)).toBeNull();
  });
});
