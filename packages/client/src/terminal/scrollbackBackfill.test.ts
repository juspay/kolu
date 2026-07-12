/** Behavioral proof of the scrollback-backfill leaf, ported from the feasibility
 *  spike (`packages/kaval/src/xtermPrepend.spike.test.ts`) into the production
 *  module. The technique is exercised against `@xterm/headless` — the same
 *  DOM-free parser the scratch replay uses — with a headless "live" terminal
 *  standing in for the browser's `@xterm/xterm`, whose internal buffer shape the
 *  CONTRACT PIN block below asserts is identical. The oracle is a control
 *  terminal fed the whole history natively: prepended history must be
 *  row-for-row indistinguishable, before and after resizes. */

import { ORPCError } from "@orpc/client";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { Terminal as XTerm } from "@xterm/xterm";
import { describe, expect, it, vi } from "vitest";
import {
  createBackfillController,
  HISTORY_CHUNK_ROWS,
  type HistoryChunk,
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

  it("keeps the SEAM row of a real serialize({range}) chunk (no trailing newline)", async () => {
    // Production chunks come from SerializeAddon.serialize({range}), whose output
    // has NO trailing newline and trims trailing blanks — so the scratch cursor
    // lands ON the last content row, not a fresh one. The steal must include that
    // row (the seam line at absolute index before-1), or every backfill boundary
    // silently drops a line. (The raw `olderChunk()` above ends in \r\n and so
    // masks this — hence a chunk built the production way.)
    const mirror = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    const ser = new SerializeAddon();
    // loadAddon takes a Terminal; the headless stand-in satisfies the addon.
    (mirror as unknown as { loadAddon(a: SerializeAddon): void }).loadAddon(
      ser,
    );
    const olderLines = Array.from({ length: 15 }, (_, i) => `h-${i}`);
    await write(mirror, `${olderLines.join("\r\n")}\r\n`);
    const chunk = ser.serialize({
      range: { start: 0, end: 14 },
      excludeModes: true,
      excludeAltBuffer: true,
    });
    expect(chunk.endsWith("\n")).toBe(false); // the production shape
    expect(chunk).toContain("h-14"); // the seam row is IN the chunk

    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, "new-000\r\n");
    const m = await prependScrollback(live, chunk, { makeScratch });
    // All 15 older rows land — including the seam "h-14" that a `ybase+y` steal
    // would drop. Before the fix this returned 14 and dropped "h-14".
    expect(m).toBe(15);
    const b = normalBuf(live);
    expect(b.lines.get(14)?.translateToString(true)).toBe("h-14"); // seam kept
    expect(b.lines.get(15)?.translateToString(true)).toBe("new-000"); // no gap
  });
});

/** A fake xterm surface for the controller: lets a test fire onScroll/onResize
 *  and control cols/viewportY without a real buffer — the controller only reads
 *  these off the term and delegates the actual splice to the injected `prepend`. */
function fakeTerm(): {
  term: XTerm;
  fireScroll(): void;
  fireResize(): void;
  setCols(n: number): void;
} {
  let scrollCb: (() => void) | undefined;
  let resizeCb: (() => void) | undefined;
  const term = {
    cols: 80,
    rows: 24,
    buffer: { active: { type: "normal", viewportY: 0 } },
    onScroll: (cb: () => void) => {
      scrollCb = cb;
      return { dispose() {} };
    },
    onResize: (cb: () => void) => {
      resizeCb = cb;
      return { dispose() {} };
    },
  };
  return {
    term: term as unknown as XTerm,
    fireScroll: () => scrollCb?.(),
    fireResize: () => resizeCb?.(),
    setCols: (n: number) => {
      term.cols = n;
    },
  };
}

/** A promise plus its resolver, for driving an in-flight fetch/prepend. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createBackfillController — near-top trigger + lifecycle races", () => {
  const chunk: HistoryChunk = { chunk: "x", topLine: 50, exhausted: false };

  it("fetches then prepends when scrolled near the top, and advances the cursor", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn<
      (t: XTerm, c: string, sc: () => boolean) => Promise<number>
    >(async () => 1);
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    c.seed(100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledWith(100, expect.any(Number));
    expect(prepend).toHaveBeenCalledTimes(1);
    // The prepend's shouldCommit guard was valid at splice time.
    const shouldCommit = prepend.mock.calls[0]?.[2];
    expect(shouldCommit?.()).toBe(true);
    c.dispose();
  });

  it("dispose() during an in-flight fetch discards the result — no prepend onto a torn-down term", async () => {
    const f = fakeTerm();
    const gate = deferred<HistoryChunk>();
    const fetch = vi.fn(() => gate.promise);
    const prepend = vi.fn(async () => 1);
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    c.seed(100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    c.dispose(); // teardown while the fetch is in flight
    gate.resolve(chunk); // the RPC resolves AFTER dispose
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).not.toHaveBeenCalled(); // never splices onto the disposed term
  });

  it("a width resize DURING prepend abandons the splice and does not clobber the paused cursor", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prependGate = deferred<number>();
    let seenShouldCommit: (() => boolean) | undefined;
    const prepend = vi.fn((_t: XTerm, _c: string, sc: () => boolean) => {
      seenShouldCommit = sc;
      return prependGate.promise;
    });
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    c.seed(100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).toHaveBeenCalledTimes(1);
    // A width change lands while prepend is suspended on its scratch replay.
    f.setCols(40);
    f.fireResize();
    // The splice guard the controller handed prepend now reads false.
    expect(seenShouldCommit?.()).toBe(false);
    prependGate.resolve(0); // prepend no-ops (would-be splice skipped)
    await new Promise((r) => setTimeout(r, 0));
    // The cursor stays PAUSED (null) — not clobbered back to the chunk's topLine.
    // Re-scroll: cursor is null (paused), so no further fetch fires.
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1); // no second fetch — paused
    c.dispose();
  });

  it("swallows a gone-terminal NOT_FOUND fetch rejection (no toast), retryable after", async () => {
    const f = fakeTerm();
    const fetch = vi
      .fn<(before: number, max: number) => Promise<HistoryChunk>>()
      .mockRejectedValueOnce(new ORPCError("NOT_FOUND"))
      .mockResolvedValueOnce(chunk);
    const prepend = vi.fn(async () => 1);
    const onError = vi.fn();
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError,
      triggerRows: 1e9,
    });
    c.seed(100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(prepend).not.toHaveBeenCalled(); // fetch rejected, no splice
    expect(onError).not.toHaveBeenCalled(); // NOT_FOUND is expected teardown
    // inFlight was cleared by the finally, so a later scroll retries.
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(prepend).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("surfaces a non-NOT_FOUND fetch fault via onError (never a silent hole), retryable after", async () => {
    const f = fakeTerm();
    const boom = new Error("connection reset");
    const fetch = vi
      .fn<(before: number, max: number) => Promise<HistoryChunk>>()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce(chunk);
    const prepend = vi.fn(async () => 1);
    const onError = vi.fn();
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError,
      triggerRows: 1e9,
    });
    c.seed(100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(boom); // surfaced, not swallowed
    expect(prepend).not.toHaveBeenCalled();
    // Still retryable — the fault didn't wedge the in-flight guard.
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(prepend).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("pages past an all-blank serialized chunk instead of stalling", async () => {
    const f = fakeTerm();
    // First fetch: a non-exhausted page that serializes to "" (an all-blank run)
    // — prepend inserts 0 rows, so the viewport never moves. Second fetch has
    // content. Without the internal paging loop the first page would STALL
    // backfill (no scroll event re-arms it) with older content still above.
    const fetch = vi
      .fn<(before: number, max: number) => Promise<HistoryChunk>>()
      .mockResolvedValueOnce({ chunk: "", topLine: 50, exhausted: false })
      .mockResolvedValueOnce({ chunk: "older", topLine: 10, exhausted: true });
    const prepend = vi.fn(async (_t: XTerm, chunkStr: string) =>
      chunkStr === "" ? 0 : 3,
    );
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    c.seed(100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    // One scroll paged THROUGH the blank chunk to the content chunk.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, 100, HISTORY_CHUNK_ROWS);
    expect(fetch).toHaveBeenNthCalledWith(2, 50, HISTORY_CHUNK_ROWS);
    c.dispose();
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
