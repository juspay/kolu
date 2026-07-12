/** Behavioral proof of the scrollback-backfill leaf, ported from the feasibility
 *  spike (`packages/kaval/src/xtermPrepend.spike.test.ts`) into the production
 *  module. The technique is exercised against `@xterm/headless` — the same
 *  DOM-free parser the scratch replay uses — with a headless "live" terminal
 *  standing in for the browser's `@xterm/xterm`, whose internal buffer shape the
 *  CONTRACT PIN block below asserts is identical. The oracle is a control
 *  terminal fed the whole history natively: prepended history must be
 *  row-for-row indistinguishable, before and after resizes. */

import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { Terminal as XTerm } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import {
  isAltBufferActive,
  prependScrollback,
  type ScratchTerminal,
} from "./scrollbackBackfill";

/* Headless scratch factory — the DOM-free replay env the tests run in. */
function headlessScratch(cols: number, rows: number): ScratchTerminal {
  return new HeadlessTerminal({
    cols,
    rows,
    scrollback: 100_000,
    allowProposedApi: true,
  }) as unknown as ScratchTerminal;
}
const makeScratch = headlessScratch;

/* A headless "live" terminal, cast to the XTerm type the module accepts — the
 *  module only touches the `_core` shape the contract-pin block proves identical.
 *  `@xterm/headless` has no renderer or selection, so it lacks the two
 *  browser-only methods the module calls (`clearSelection`, `refresh`); stub them
 *  as no-ops (there is no selection to clear and no atlas to repaint headlessly)
 *  so the stand-in presents the same surface the production `@xterm/xterm` does.
 */
function makeLive(opts: {
  cols: number;
  rows: number;
  scrollback: number;
}): XTerm {
  const t = new HeadlessTerminal({
    ...opts,
    allowProposedApi: true,
  }) as unknown as XTerm & { clearSelection(): void; refresh(): void };
  t.clearSelection = () => {};
  t.refresh = () => {};
  return t;
}

function write(
  term: { write(d: string, cb?: () => void): void },
  data: string,
) {
  return new Promise<void>((r) => term.write(data, r));
}

interface BufInternal {
  lines: {
    length: number;
    get(
      i: number,
    ):
      | { isWrapped: boolean; translateToString(t?: boolean): string }
      | undefined;
  };
  ydisp: number;
  ybase: number;
}
function normalBuf(term: XTerm): BufInternal {
  return (term as unknown as { _core: { buffers: { normal: BufInternal } } })
    ._core.buffers.normal;
}
function dumpRows(term: XTerm): Array<[string, boolean]> {
  const b = normalBuf(term);
  const out: Array<[string, boolean]> = [];
  for (let i = 0; i < b.lines.length; i++) {
    const l = b.lines.get(i);
    if (!l) throw new Error(`row ${i} missing`);
    out.push([l.translateToString(true), l.isWrapped]);
  }
  return out;
}
function viewportRows(term: XTerm): string[] {
  const b = normalBuf(term);
  const out: string[] = [];
  for (let i = 0; i < term.rows; i++) {
    out.push(b.lines.get(b.ydisp + i)?.translateToString(true) ?? "<missing>");
  }
  return out;
}

const COLS = 20;
const ROWS = 5;

/** older history: 30 lines, one wrapping (3 rows at 20 cols) and one colored. */
function olderChunk(): string {
  const lines: string[] = [];
  for (let i = 0; i < 30; i++) {
    if (i === 7)
      lines.push(`old-${String(i).padStart(3, "0")}-${"W".repeat(45)}`);
    else if (i === 13)
      lines.push(`\x1b[31mold-${String(i).padStart(3, "0")}-red\x1b[0m`);
    else lines.push(`old-${String(i).padStart(3, "0")}`);
  }
  return `${lines.join("\r\n")}\r\n`;
}
function newerChunk(): string {
  const lines: string[] = [];
  for (let i = 0; i < 50; i++) lines.push(`new-${String(i).padStart(3, "0")}`);
  return `${lines.join("\r\n")}\r\n`;
}

describe("prependScrollback", () => {
  it("prepends older lines above existing content, coherently", async () => {
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, newerChunk());
    const before = {
      ybase: normalBuf(live).ybase,
      ydisp: normalBuf(live).ydisp,
      len: normalBuf(live).lines.length,
      viewport: viewportRows(live),
    };
    expect(normalBuf(live).lines.get(0)?.translateToString(true)).toBe(
      "new-000",
    );

    const m = await prependScrollback(live, olderChunk(), { makeScratch });
    // 30 logical lines, one wraps to 3 rows at 20 cols => 32 buffer rows.
    expect(m).toBe(32);

    const b = normalBuf(live);
    expect(b.lines.length).toBe(before.len + m);
    expect(b.lines.get(0)?.translateToString(true)).toBe("old-000");
    expect(b.lines.get(m)?.translateToString(true)).toBe("new-000");
    // Wrap flags survived the theft: old-007's continuation rows.
    expect(b.lines.get(7)?.isWrapped).toBe(false);
    expect(b.lines.get(8)?.isWrapped).toBe(true);
    expect(b.lines.get(9)?.isWrapped).toBe(true);
    // Registers shifted in lockstep -> the visible content did not move.
    expect(b.ybase).toBe(before.ybase + m);
    expect(b.ydisp).toBe(before.ydisp + m);
    expect(viewportRows(live)).toEqual(before.viewport);

    // The terminal still behaves: an append after the prepend lands at the bottom.
    await write(live, "after-prepend\r\n");
    const b2 = normalBuf(live);
    expect(
      b2.lines
        .get(
          b2.ybase +
            (live as unknown as { _core: { buffer: { y: number } } })._core
              .buffer.y -
            1,
        )
        ?.translateToString(true),
    ).toBe("after-prepend");
  });

  it("keeps a scrolled-up viewport anchored", async () => {
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, newerChunk());
    (live as unknown as { scrollLines(n: number): void }).scrollLines(-10);
    const anchored = viewportRows(live);
    expect(normalBuf(live).ydisp).toBe(normalBuf(live).ybase - 10);

    await prependScrollback(live, olderChunk(), { makeScratch });

    expect(viewportRows(live)).toEqual(anchored);
    expect(normalBuf(live).ydisp).toBe(normalBuf(live).ybase - 10);
  });

  it("reflows prepended history exactly like natively-written history", async () => {
    const a = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(a, newerChunk());
    await prependScrollback(a, olderChunk(), { makeScratch });

    const b = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(b, olderChunk() + newerChunk());

    expect(dumpRows(a)).toEqual(dumpRows(b));
    a.resize(10, ROWS);
    b.resize(10, ROWS);
    expect(dumpRows(a)).toEqual(dumpRows(b));
    a.resize(40, ROWS);
    b.resize(40, ROWS);
    expect(dumpRows(a)).toEqual(dumpRows(b));
    a.resize(40, 8);
    b.resize(40, 8);
    await write(a, "tail\r\n");
    await write(b, "tail\r\n");
    expect(dumpRows(a)).toEqual(dumpRows(b));
  });

  it("preserves SGR attributes through the scratch-replay theft", async () => {
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, newerChunk());
    await prependScrollback(live, olderChunk(), { makeScratch });
    // old-013 was written red; old-007 wrapped into 3 rows, so it sits at row 15.
    const line = (live.buffer.active.getLine(15) as unknown as {
      translateToString(t?: boolean): string;
      getCell(i: number): { getFgColor(): number } | undefined;
    })!;
    expect(line.translateToString(true)).toBe("old-013-red");
    expect(line.getCell(0)?.getFgColor()).toBe(1); // ANSI red
  });

  it("THROWS when the prepend would overflow maxLength (no silent trim)", async () => {
    // scrollback 20 at 5 rows -> maxLength 25; 50 newer lines fill it.
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 20 });
    await write(live, newerChunk());
    await expect(
      prependScrollback(live, olderChunk(), { makeScratch }),
    ).rejects.toThrow(/would overflow/);
  });

  it("THROWS when xterm's internal shape is missing (no silent no-op)", async () => {
    const broken = {
      cols: COLS,
      rows: ROWS,
      clearSelection() {},
      buffer: { active: { type: "normal" } },
    } as unknown as XTerm;
    await expect(
      prependScrollback(broken, olderChunk(), { makeScratch }),
    ).rejects.toThrow(/internals contract broken/);
  });

  it("skips (returns 0) on an empty chunk without touching the buffer", async () => {
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, newerChunk());
    const before = normalBuf(live).lines.length;
    expect(await prependScrollback(live, "", { makeScratch })).toBe(0);
    expect(normalBuf(live).lines.length).toBe(before);
  });

  it("skips (returns 0) while the alt buffer is active", async () => {
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, newerChunk());
    await write(live, "\x1b[?1049h"); // enter alt buffer
    expect(
      isAltBufferActive(
        live as unknown as { buffer: { active: { type: string } } },
      ),
    ).toBe(true);
    expect(await prependScrollback(live, olderChunk(), { makeScratch })).toBe(
      0,
    );
  });
});

describe("CONTRACT PIN — @xterm/xterm internal shape", () => {
  // Any @xterm/xterm bump that moves one of these must fail HERE, loudly, not in
  // a user's scrollback. Constructs (does NOT open) a real browser Terminal and
  // asserts every symbol scrollbackBackfill.ts pins.
  it("every internal symbol the technique touches exists with the expected shape", () => {
    const t = new XTerm({
      cols: COLS,
      rows: ROWS,
      scrollback: 10,
      allowProposedApi: true,
    });
    const core = (t as unknown as { _core?: Record<string, unknown> })._core;
    expect(core, "_core").toBeTruthy();

    const bufSvc = core!._bufferService as Record<string, unknown> | undefined;
    expect(
      (bufSvc?._onScroll as { fire?: unknown } | undefined)?.fire,
      "_bufferService._onScroll.fire",
    ).toBeTypeOf("function");

    const normal = (core!.buffers as { normal?: Record<string, unknown> })
      .normal;
    expect(normal, "_core.buffers.normal").toBeTruthy();
    expect(normal!.ydisp, "buffer.ydisp").toBeTypeOf("number");
    expect(normal!.ybase, "buffer.ybase").toBeTypeOf("number");
    expect(normal!.y, "buffer.y").toBeTypeOf("number");
    expect(normal!.savedY, "buffer.savedY").toBeTypeOf("number");

    const lines = normal!.lines as {
      length: number;
      maxLength: number;
      get: unknown;
      splice: unknown;
      onInsert: (l: (e: { index: number; amount: number }) => void) => unknown;
    };
    expect(lines.length, "lines.length").toBeTypeOf("number");
    expect(lines.maxLength, "lines.maxLength").toBeTypeOf("number");
    expect(lines.get, "lines.get").toBeTypeOf("function");
    expect(lines.splice, "lines.splice").toBeTypeOf("function");
    expect(lines.onInsert, "lines.onInsert").toBeTypeOf("function");

    // Behavioral pin: splice(0,0,line) inserts at the front and fires onInsert.
    const line = (lines as unknown as { get(i: number): unknown }).get(0);
    expect(line, "lines.get(0)").toBeTruthy();
    let insertEvent: { index: number; amount: number } | undefined;
    lines.onInsert((e) => (insertEvent = e));
    const before = lines.length;
    (
      lines as unknown as {
        splice(a: number, b: number, ...i: unknown[]): void;
      }
    ).splice(0, 0, line);
    expect(lines.length).toBe(before + 1);
    expect(insertEvent).toEqual({ index: 0, amount: 1 });
  });
});
