/** Behavioral proof of the scrollback-backfill leaf, ported from the feasibility
 *  spike (branch `xterm-prepend-spike`, commit `b3cfa37d1`, not in this tree) into the production
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
  type BackfillController,
  createBackfillController,
  defaultScratch,
  HISTORY_CHUNK_ROWS,
  type HistoryChunk,
  isAltBufferActive,
  type PrependResult,
  prependScrollback,
  type ScratchTerminal,
  SNAPSHOT_SEED_SEAM_OSC,
} from "./scrollbackBackfill";

/** The prepend seam the controller tests inject: a fixed `inserted` result. */
const inserted = (rows: number): PrependResult => ({ kind: "inserted", rows });

/** Extract the OSC payload (the per-frame token) from a controller-minted seam
 *  (`ESC ] <ident> ; <token> BEL`) — what xterm hands the OSC handler, so a test
 *  can fire the seam through the fake term exactly as production parsing would. */
function seamPayload(seam: string): string {
  return seam.slice(seam.indexOf(";") + 1, -1);
}

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

    const m = await prependScrollback(live, olderChunk(), 0, { makeScratch });
    // 30 logical lines, one wraps to 3 rows at 20 cols => 32 buffer rows.
    expect(m).toEqual({ kind: "inserted", rows: 32 });

    const b = normalBuf(live);
    expect(b.lines.length).toBe(before.len + 32);
    expect(b.lines.get(0)?.translateToString(true)).toBe("old-000");
    expect(b.lines.get(32)?.translateToString(true)).toBe("new-000");
    // Wrap flags survived the theft: old-007's continuation rows.
    expect(b.lines.get(7)?.isWrapped).toBe(false);
    expect(b.lines.get(8)?.isWrapped).toBe(true);
    expect(b.lines.get(9)?.isWrapped).toBe(true);
    // Registers shifted in lockstep -> the visible content did not move.
    expect(b.ybase).toBe(before.ybase + 32);
    expect(b.ydisp).toBe(before.ydisp + 32);
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

    await prependScrollback(live, olderChunk(), 0, { makeScratch });

    expect(viewportRows(live)).toEqual(anchored);
    expect(normalBuf(live).ydisp).toBe(normalBuf(live).ybase - 10);
  });

  it("reflows prepended history exactly like natively-written history", async () => {
    const a = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(a, newerChunk());
    await prependScrollback(a, olderChunk(), 0, { makeScratch });

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
    await prependScrollback(live, olderChunk(), 0, { makeScratch });
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
      prependScrollback(live, olderChunk(), 0, { makeScratch }),
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
      prependScrollback(broken, olderChunk(), 0, { makeScratch }),
    ).rejects.toThrow(/internals contract broken/);
  });

  it("inserts 0 rows on an empty chunk of an EMPTY range (servedRows 0)", async () => {
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, newerChunk());
    const before = normalBuf(live).lines.length;
    expect(await prependScrollback(live, "", 0, { makeScratch })).toEqual({
      kind: "inserted",
      rows: 0,
    });
    expect(normalBuf(live).lines.length).toBe(before);
  });

  it("materializes an ALL-BLANK range (empty chunk, servedRows > 0)", async () => {
    // An entirely-blank history range serializes to "" yet spans servedRows>0
    // mirror rows. The empty-chunk fast path must NOT swallow it: those blank
    // rows are real content and have to land, or a blank run in scrollback
    // silently collapses (F10). Cover the exact one-row case codex named.
    const one = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(one, "new-000\r\n");
    const beforeOne = normalBuf(one).lines.length;
    expect(await prependScrollback(one, "", 1, { makeScratch })).toEqual({
      kind: "inserted",
      rows: 1,
    });
    const bOne = normalBuf(one);
    expect(bOne.lines.length).toBe(beforeOne + 1);
    expect(bOne.lines.get(0)?.translateToString(true)).toBe(""); // the blank row
    expect(bOne.lines.get(1)?.translateToString(true)).toBe("new-000"); // no gap

    // A multi-row blank range materializes its full span too.
    const many = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(many, "new-000\r\n");
    expect(await prependScrollback(many, "", 5, { makeScratch })).toEqual({
      kind: "inserted",
      rows: 5,
    });
    const bMany = normalBuf(many);
    for (let i = 0; i < 5; i++)
      expect(bMany.lines.get(i)?.translateToString(true)).toBe("");
    expect(bMany.lines.get(5)?.translateToString(true)).toBe("new-000");
  });

  it("returns a distinct `skipped` (not an empty insert) while the alt buffer is active", async () => {
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, newerChunk());
    await write(live, "\x1b[?1049h"); // enter alt buffer
    expect(
      isAltBufferActive(
        live as unknown as { buffer: { active: { type: string } } },
      ),
    ).toBe(true);
    // `skipped`, NOT `{inserted, rows:0}`: the caller must be able to tell "nothing
    // consumed" from "consumed, 0 rows" so it never advances its cursor past an
    // unspliced band (the silent-hole bug).
    expect(
      await prependScrollback(live, olderChunk(), 0, { makeScratch }),
    ).toEqual({ kind: "skipped" });
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
    const m = await prependScrollback(live, chunk, 15, { makeScratch });
    // All 15 older rows land — including the seam "h-14" that a `ybase+y` steal
    // would drop. Before the fix this returned 14 and dropped "h-14".
    expect(m).toEqual({ kind: "inserted", rows: 15 });
    const b = normalBuf(live);
    expect(b.lines.get(14)?.translateToString(true)).toBe("h-14"); // seam kept
    expect(b.lines.get(15)?.translateToString(true)).toBe("new-000"); // no gap
  });

  it("materializes a range's trailing blank rows via servedRows (F10 fidelity)", async () => {
    // A history range that ENDS in a blank row. `serialize({range})` has no
    // trailing newline, so replaying its bytes leaves the scratch cursor on that
    // final blank row with x === 0 — which the content-only steal (`x > 0`) does
    // NOT count, silently dropping one blank row at every chunk seam and
    // compressing the backfilled buffer's spacing below native history.
    // `servedRows` (= before - topLine, the mirror-range span) restores it: the
    // steal takes `max(content, servedRows)` rows, and the extra rows are the
    // scratch's OWN distinct initialized blank BufferLines — no aliasing, no
    // newline padding.
    const mirror = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    const ser = new SerializeAddon();
    (mirror as unknown as { loadAddon(a: SerializeAddon): void }).loadAddon(
      ser,
    );
    // Rows 0..4 content, then blank rows 5..7 — cursor ends on the blank row 7.
    await write(mirror, "c-0\r\nc-1\r\nc-2\r\nc-3\r\nc-4\r\n\r\n\r\n");
    const span = 8; // range rows 0..7 inclusive = before(8) - topLine(0)
    const chunk = ser.serialize({
      range: { start: 0, end: 7 },
      excludeModes: true,
      excludeAltBuffer: true,
    });

    // Baseline: servedRows = 0 replays content only, dropping the final blank row.
    const dropped = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(dropped, "new-000\r\n");
    expect(await prependScrollback(dropped, chunk, 0, { makeScratch })).toEqual(
      {
        kind: "inserted",
        rows: 7,
      },
    );

    // Fixed: servedRows = span materializes the full 8-row range (row 7 restored).
    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, "new-000\r\n");
    const m = await prependScrollback(live, chunk, span, { makeScratch });
    expect(m).toEqual({ kind: "inserted", rows: span });
    const b = normalBuf(live);
    expect(b.lines.get(4)?.translateToString(true)).toBe("c-4");
    expect(b.lines.get(5)?.translateToString(true)).toBe(""); // blank rows kept
    expect(b.lines.get(6)?.translateToString(true)).toBe("");
    expect(b.lines.get(7)?.translateToString(true)).toBe(""); // the dropped one
    // No compression: the seam still abuts the live content, the full span down.
    expect(b.lines.get(8)?.translateToString(true)).toBe("new-000");
  });
});

/** A fake xterm surface for the controller: lets a test fire onScroll/onResize
 *  and control cols/viewportY without a real buffer — the controller only reads
 *  these off the term and delegates the actual splice to the injected `prepend`. */
function fakeTerm(): {
  term: XTerm;
  fireScroll(): void;
  fireResize(): void;
  fireRis(): void;
  fireOsc(payload: string): boolean | undefined;
  setCols(n: number): void;
  setAltActive(b: boolean): void;
} {
  let scrollCb: (() => void) | undefined;
  let resizeCb: (() => void) | undefined;
  let escCb: (() => boolean | undefined) | undefined;
  let oscCb: ((data: string) => boolean | undefined) | undefined;
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
    parser: {
      // The controller registers a RIS (ESC c) esc handler to pause on an in-band
      // reset; capture it so a test can fire it (F1).
      registerEscHandler: (_id: unknown, cb: () => boolean | undefined) => {
        escCb = cb;
        return { dispose() {} };
      },
      // The controller registers the snapshot-seed seam OSC handler; capture it so
      // a test can fire it at the snapshot's byte position with a chosen payload
      // (the per-frame token for a real seam, F11; an arbitrary string for a
      // foreign-program forgery, F12).
      registerOscHandler: (
        _id: unknown,
        cb: (data: string) => boolean | undefined,
      ) => {
        oscCb = cb;
        return { dispose() {} };
      },
    },
  };
  return {
    term: term as unknown as XTerm,
    fireScroll: () => scrollCb?.(),
    fireResize: () => resizeCb?.(),
    fireRis: () => escCb?.(),
    fireOsc: (payload: string) => oscCb?.(payload),
    setCols: (n: number) => {
      term.cols = n;
    },
    setAltActive: (b: boolean) => {
      term.buffer.active.type = b ? "alternate" : "normal";
    },
  };
}

/** Seed the controller through its ONLY legitimate path — the reset+seed fused
 *  `consumeSnapshotFrame`, whose committer stands in for "the snapshot parsed"
 *  when run immediately (the bare `seed()` transition was removed, F3). Models
 *  the INITIAL attach snapshot (no leading RIS — `carriesReset` false). Fires the
 *  snapshot-seed seam first, mirroring production: the seam parses before the
 *  frame's own bytes and captures the committer's baseline (F11). */
function seedController(
  f: ReturnType<typeof fakeTerm>,
  c: BackfillController,
  topLine: number,
  epoch?: number,
): void {
  const { commit, seam } = c.consumeSnapshotFrame(topLine, epoch, false);
  f.fireOsc(seamPayload(seam));
  commit();
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
  const chunk: HistoryChunk = {
    kind: "chunk",
    chunk: "x",
    topLine: 50,
    exhausted: false,
  };

  it("fetches then prepends when scrolled near the top, and advances the cursor", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn<
      (t: XTerm, c: string, sc: () => boolean) => Promise<PrependResult>
    >(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledWith(100, expect.any(Number), undefined);
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
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
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
    const prependGate = deferred<PrependResult>();
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
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).toHaveBeenCalledTimes(1);
    // A width change lands while prepend is suspended on its scratch replay.
    f.setCols(40);
    f.fireResize();
    // The splice guard the controller handed prepend now reads false.
    expect(seenShouldCommit?.()).toBe(false);
    prependGate.resolve({ kind: "skipped" }); // prepend no-ops (splice skipped)
    await new Promise((r) => setTimeout(r, 0));
    // The cursor stays PAUSED (null) — not clobbered back to the chunk's topLine.
    // Re-scroll: cursor is null (paused), so no further fetch fires.
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1); // no second fetch — paused
    c.dispose();
  });

  it("echoes the seeded reflow epoch, and HALTS on a stale reply from a foreign reflow (F3)", async () => {
    const f = fakeTerm();
    // The host reports `stale` (its reflow generation moved since our seed), so
    // the controller must discard the reply and PAUSE rather than splice a
    // renumbered cursor's duplicated/skipped band.
    const fetch = vi.fn(async () => ({ kind: "stale" as const }));
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100, 7); // seeded under reflow generation 7
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    // The stamped epoch rode the fetch...
    expect(fetch).toHaveBeenCalledWith(100, expect.any(Number), 7);
    // ...and a stale reply never splices.
    expect(prepend).not.toHaveBeenCalled();
    // Backfill is now PAUSED: a re-scroll fires no further fetch until re-seed.
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("swallows a gone-terminal NOT_FOUND fetch rejection (no toast), retryable after", async () => {
    const f = fakeTerm();
    const fetch = vi
      .fn<(before: number, max: number) => Promise<HistoryChunk>>()
      .mockRejectedValueOnce(new ORPCError("NOT_FOUND"))
      .mockResolvedValueOnce(chunk);
    const prepend = vi.fn(async () => inserted(1));
    const onError = vi.fn();
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError,
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
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
    const prepend = vi.fn(async () => inserted(1));
    const onError = vi.fn();
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError,
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
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

  it("an alt-buffer switch DURING an in-flight fetch does NOT advance the cursor (no silent hole)", async () => {
    const f = fakeTerm();
    const gate = deferred<HistoryChunk>();
    const fetch = vi.fn(() => gate.promise);
    // The injected prepend mirrors the production one: it SKIPS (consumes
    // nothing) when the alt buffer is active at splice time.
    const prepend = vi.fn(
      async (): Promise<PrependResult> =>
        isAltBufferActive(
          f.term as unknown as { buffer: { active: { type: string } } },
        )
          ? { kind: "skipped" }
          : inserted(1),
    );
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledWith(100, expect.any(Number), undefined);
    // A full-screen TUI (vim/less) enters the alt buffer WHILE the fetch is in
    // flight — the loop-top alt guard already passed, so this lands mid-await.
    f.setAltActive(true);
    gate.resolve(chunk); // fetch resolves; the prepend now skips (returns `skipped`)
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).toHaveBeenCalledTimes(1);
    // The cursor must NOT have advanced past the un-spliced band: on alt exit and
    // a re-scroll, the SAME `before=100` is re-fetched — no hole, band re-owed.
    f.setAltActive(false);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(100, expect.any(Number), undefined);
    c.dispose();
  });

  it("consumeSnapshotFrame invalidates an in-flight fetch synchronously, then seeds only when its committer runs", async () => {
    const f = fakeTerm();
    const gate = deferred<HistoryChunk>();
    const fetch = vi.fn(() => gate.promise);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);

    // A mid-stream overflow re-attach snapshot frame arrives: consume it. This
    // must SYNCHRONOUSLY invalidate the in-flight fetch (so its continuation
    // can't splice across the RIS reset) and return a committer that seeds later.
    // It carries a leading RIS (`carriesReset` true, an overflow re-attach).
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, true);
    gate.resolve(chunk); // the old fetch resolves AFTER the frame
    await new Promise((r) => setTimeout(r, 0));
    // Discarded — never spliced onto the reset buffer.
    expect(prepend).not.toHaveBeenCalled();

    // Before the committer runs the cursor is paused: a scroll fires no fetch.
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);

    // The frame's bytes parse in order: its snapshot-seed seam FIRST (captures the
    // committer's baseline at that byte position), then its own leading RIS (which
    // pauses — but the baseline predicted that single bump, so the committer is
    // not revoked, F11).
    f.fireOsc(seamPayload(seam));
    f.fireRis();
    // Running the committer (as the write callback would, once the snapshot
    // parsed) seeds the NEW cursor + reflow epoch; the next scroll fetches from 30.
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(30, expect.any(Number), 2);
    c.dispose();
  });

  it("an in-band RIS (ESC c) during an in-flight fetch invalidates it — no splice across the reset (F1)", async () => {
    const f = fakeTerm();
    const gate = deferred<HistoryChunk>();
    const fetch = vi.fn(() => gate.promise);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);

    // A PTY-originated RIS rides the live delta stream; xterm parses it and the
    // controller's esc handler fires — invalidating the in-flight fetch's
    // continuation before it can splice pre-reset bytes onto the reset buffer.
    f.fireRis();
    gate.resolve(chunk); // the old fetch resolves AFTER the reset
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).not.toHaveBeenCalled(); // discarded — never spliced

    // Backfill is now PAUSED: a re-scroll fires no further fetch until re-seed.
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("a snapshot committer a LATER invalidation superseded is a no-op — no stale re-seed (F2)", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    // A snapshot frame arrives; its seam parses (baseline captured), then its
    // parse (the committer) is deferred.
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, false);
    f.fireOsc(seamPayload(seam));
    // AFTER the seam captured the baseline, a WIDTH resize reflows the buffer —
    // bumping the generation past that baseline. The controller must stay PAUSED,
    // not resurrect the pre-resize cursor when the now-stale committer finally
    // runs. (Distinct from F11: this reset landed AFTER the snapshot's bytes.)
    f.setCols(40);
    f.fireResize();
    commit(); // the old snapshot's write callback finally fires — but it's stale
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    // The stale committer did NOT seed: paused, so no fetch.
    expect(fetch).not.toHaveBeenCalled();
    c.dispose();
  });

  it("a resize BETWEEN a snapshot's receipt and its seam still suppresses the seed (F2 receipt-to-parse)", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    // The frame is RECEIVED (pauses, arms the committer) but its seam has NOT
    // parsed yet — e.g. its write is buffered under scroll lock. A WIDTH resize
    // reflows the buffer in THIS window, then the seam parses only afterward. A
    // seam-only baseline would capture the generation AFTER the resize's bump and
    // fold it in — forgiving the invalidation and letting the stale committer seed
    // against the reflowed buffer (the reopened F2 race). The receipt-captured
    // lifecycle token catches the out-of-band resize regardless of byte position,
    // so the committer must stay a no-op.
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, false);
    f.setCols(40);
    f.fireResize(); // reflow lands BEFORE the seam parses
    f.fireOsc(seamPayload(seam)); // seam parses only now, past the resize
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled(); // stale committer did not seed
    c.dispose();
  });

  it("an overflow re-attach snapshot's OWN leading RIS does NOT revoke its committer — backfill resumes (F11)", async () => {
    // Production ordering an overflow re-attach follows: consumeSnapshotFrame
    // (invalidates + arms committer) → xterm parses the frame's seam then its
    // leading RIS (`SEAM + TERMINAL_RESET + snapshot`) → the write callback runs
    // the committer → scroll → fetch. The seam captures the committer's baseline
    // at the snapshot's byte position, predicting the one bump the frame's own RIS
    // makes — so that RIS does not read as an invalidation and revoke the
    // committer (which left backfill dead after every re-attach). The composition
    // the two independent F1/F2 tests missed.
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    // An overflow re-attach snapshot frame — its data leads with a RIS.
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, true);
    // Its bytes parse in order: seam (baseline capture) then the leading RIS.
    f.fireOsc(seamPayload(seam));
    f.fireRis();
    // The write callback then seeds — the committer survived the frame's own RIS.
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(30, expect.any(Number), 2);

    // A subsequent FOREIGN live-delta RIS (no seam ahead of it) still invalidates,
    // so F1 remains intact after the re-attach.
    f.fireRis();
    fetch.mockClear();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    c.dispose();
  });

  it("a foreign RIS buffered AHEAD of a re-attach snapshot does NOT steal its seed — backfill resumes (F11 byte order)", async () => {
    // The scroll-lock coalescing case codex flagged: while scroll-locked, a
    // foreign live-delta RIS is buffered, THEN an overflow re-attach snapshot.
    // flush() joins them, so the bytes parse as [foreign RIS][seam][own RIS][snap]
    // — the foreign RIS parses BEFORE the snapshot's own. A receipt-time credit
    // counter would let that older foreign RIS consume the snapshot's absorb, so
    // the snapshot's own RIS then revoked its committer and backfill stayed dead.
    // The seam captures the baseline AFTER the foreign RIS has paused, so the
    // snapshot — later in byte order, the valid replacement cursor — still seeds.
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, true);
    // Byte order under the joined flush: the foreign RIS FIRST (pauses)...
    f.fireRis();
    // ...then the snapshot's seam (captures baseline past that pause) and its own
    // leading RIS (the predicted bump).
    f.fireOsc(seamPayload(seam));
    f.fireRis();
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    // Seeded from the snapshot despite the earlier foreign RIS — not left halted.
    expect(fetch).toHaveBeenLastCalledWith(30, expect.any(Number), 2);
    c.dispose();
  });

  it("an interleaved foreign RIS between two buffered snapshots — the NEWEST snapshot seeds (F11 byte order)", async () => {
    // Two overflow re-attaches buffered under one scroll lock, with a foreign RIS
    // between them: bytes parse [seam1][RIS1][snap1][foreign RIS][seam2][RIS2][snap2].
    // The foreign RIS lands AFTER snap1 (so snap1's committer is correctly revoked)
    // but BEFORE snap2 (so snap2 — the newest valid snapshot — must still seed).
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    // Both frames received (each pauses + pushes a pending seed), in receipt order.
    const { commit: commit1, seam: seam1 } = c.consumeSnapshotFrame(
      30,
      2,
      true,
    );
    const { commit: commit2, seam: seam2 } = c.consumeSnapshotFrame(
      20,
      3,
      true,
    );
    // Parse in byte order: snap1's seam+RIS, the foreign RIS, snap2's seam+RIS.
    // Each seam carries its own token, so it pops ITS pending seed (FIFO order).
    f.fireOsc(seamPayload(seam1)); // pops snap1's pending seed, baseline1
    f.fireRis(); // snap1's own RIS
    f.fireRis(); // FOREIGN RIS — lands after snap1, before snap2
    f.fireOsc(seamPayload(seam2)); // pops snap2's pending seed, baseline2 (past the foreign RIS)
    f.fireRis(); // snap2's own RIS
    // Committers fire in buffer order once the joined write parses.
    commit1(); // superseded by the foreign RIS after it — a no-op
    commit2(); // the newest valid snapshot — seeds
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(20, expect.any(Number), 3);
    c.dispose();
  });

  it("a foreign OSC on the seam ident (unmatched token) neither steals a pending seed nor throws (F12)", async () => {
    // The seam's OSC ident is ordinary PTY-controlled output — any program can
    // emit `ESC ] 60697 …` with an arbitrary payload while a real seed is pending.
    // It must be IGNORED: not throw, not pop the pending seed. Only the real
    // seam's per-frame token matches, so the snapshot that follows still captures
    // its baseline and seeds.
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, false);
    // Program output on the ident, with a payload that is NOT this frame's token.
    expect(f.fireOsc("60697-forged-by-a-program")).toBe(true); // consumed, no throw
    // The real seam still matches the front token and captures the baseline.
    f.fireOsc(seamPayload(seam));
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    // The pending seed was not stolen — the snapshot seeded normally.
    expect(fetch).toHaveBeenLastCalledWith(30, expect.any(Number), 2);
    c.dispose();
  });

  it("a foreign OSC on the seam ident with an EMPTY FIFO is ignored, not thrown (F12)", () => {
    // No snapshot has been consumed, so no seed is pending. A program emitting the
    // ident must not throw out of xterm's OSC parser (which would interrupt
    // terminal parsing) — the handler consumes it and leaves the FIFO empty.
    const f = fakeTerm();
    const c = createBackfillController(f.term, {
      fetch: vi.fn(async () => chunk),
      prepend: vi.fn(async () => inserted(1)),
      onError: () => {},
      triggerRows: 1e9,
    });
    expect(() => f.fireOsc("anything")).not.toThrow();
    expect(f.fireOsc("anything")).toBe(true);
    c.dispose();
  });

  it("mints seam tokens without crypto.randomUUID — works in an insecure context (F14)", async () => {
    // kolu is reached over plain HTTP on a LAN, where `crypto.randomUUID` (a
    // secure-context-only API) is ABSENT. The token generator must not touch it:
    // `getRandomValues` is available in insecure contexts. Simulate that origin by
    // removing `randomUUID` from the global crypto, then drive a full seed —
    // consumeSnapshotFrame must not throw, the seam must carry a fresh unguessable
    // token, and back-to-back frames must get DISTINCT tokens.
    const original = crypto.randomUUID;
    // biome-ignore lint/suspicious/noExplicitAny: deleting an optional API for the sim
    delete (crypto as any).randomUUID;
    try {
      const f = fakeTerm();
      const fetch = vi.fn(async () => chunk);
      const c = createBackfillController(f.term, {
        fetch,
        prepend: vi.fn(async () => inserted(1)),
        onError: () => {},
        triggerRows: 1e9,
      });
      const first = c.consumeSnapshotFrame(30, 2, false);
      const second = c.consumeSnapshotFrame(40, 2, false);
      const t1 = seamPayload(first.seam);
      const t2 = seamPayload(second.seam);
      expect(t1, "token is a 128-bit hex string").toMatch(/^[0-9a-f]{32}$/);
      expect(t2).toMatch(/^[0-9a-f]{32}$/);
      expect(t1, "each frame gets a distinct token").not.toBe(t2);
      // The seed still commits through the seam — no throw. Drain the FIFO in byte
      // order (t1 then t2), then commit the live (second) frame: it seeds at 40.
      f.fireOsc(t1);
      f.fireOsc(t2);
      second.commit();
      f.fireScroll();
      await new Promise((r) => setTimeout(r, 0));
      expect(fetch).toHaveBeenCalledWith(40, expect.any(Number), 2);
      c.dispose();
    } finally {
      // biome-ignore lint/suspicious/noExplicitAny: restore the real API
      (crypto as any).randomUUID = original;
    }
  });

  it("pages past an inserted-0 chunk instead of stalling (defensive loop)", async () => {
    const f = fakeTerm();
    // A page the prepend consumes but inserts 0 rows from — the viewport never
    // moves, so no scroll event would re-arm the fetch; the internal paging loop
    // continues to the next page instead of STALLING with older content above.
    // (In production the F10 servedRows materialization makes a real served page
    // always insert ≥1 row, so this inserted-0-non-exhausted path is defensive —
    // it must page, never advance-and-halt. An `inserted` result with rows 0 is
    // still a CONSUMED page, distinct from a `skipped` one, which would NOT
    // advance the cursor.)
    const fetch = vi
      .fn<(before: number, max: number) => Promise<HistoryChunk>>()
      .mockResolvedValueOnce({
        kind: "chunk",
        chunk: "",
        topLine: 50,
        exhausted: false,
      })
      .mockResolvedValueOnce({
        kind: "chunk",
        chunk: "older",
        topLine: 10,
        exhausted: true,
      });
    const prepend = vi.fn(async (_t: XTerm, chunkStr: string) =>
      chunkStr === "" ? inserted(0) : inserted(3),
    );
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      onError: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    // One scroll paged THROUGH the blank chunk to the content chunk.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      100,
      HISTORY_CHUNK_ROWS,
      undefined,
    );
    expect(fetch).toHaveBeenNthCalledWith(2, 50, HISTORY_CHUNK_ROWS, undefined);
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

  it("the SHIPPED defaultScratch parses an unopened write() into rows and fires the callback", async () => {
    // The production prepend replays every chunk through `defaultScratch` — an
    // UNOPENED @xterm/xterm. Its one load-bearing assumption is that an unopened
    // write() parses bytes into the buffer AND fires its callback. Exercise the
    // EXACT shipped export (imported, never a reconstructed equivalent) so a
    // caret-range @xterm bump that defers pre-open parsing turns RED here — not
    // into silent scrollback corruption (blank rows spliced as history) or a
    // wedged `inFlight` (callback never fires). Pin the artifact, not a copy.
    const scratch = defaultScratch(20, 5);
    try {
      let fired = false;
      await new Promise<void>((resolve) =>
        scratch.write("hello\r\nworld", () => {
          fired = true;
          resolve();
        }),
      );
      expect(fired, "unopened write() callback fired").toBe(true);
      // The bytes parsed into the same `_core.buffers.normal` the steal reads.
      const norm = normalBuf(scratch as unknown as XTerm);
      expect(norm.lines.get(0)?.translateToString(true)).toBe("hello");
      expect(norm.lines.get(1)?.translateToString(true)).toBe("world");
    } finally {
      scratch.dispose();
    }
  });

  it("a token-carrying seam is a no-op OSC that delivers the token payload and emits nothing", async () => {
    // The F11/F12 fix rides one contract: writing `ESC ] 60697 ; <token> BEL`
    // into a real @xterm/xterm fires the registered OSC handler for that ident,
    // hands it the exact TOKEN payload (so the controller can match provenance,
    // F12), AND leaves the buffer untouched (zero-width, no visible cell). An
    // xterm bump that changes OSC parsing — a printed artifact, the handler not
    // firing, or a mangled payload — must fail HERE, loudly, not corrupt a
    // snapshot's first row or silently break the byte-position baseline capture.
    const t = new XTerm({
      cols: COLS,
      rows: ROWS,
      scrollback: 10,
      allowProposedApi: true,
    });
    const seam = `\x1b]${SNAPSHOT_SEED_SEAM_OSC};tok-abc123\x07`;
    let fired = 0;
    let seen: string | undefined;
    t.parser.registerOscHandler(SNAPSHOT_SEED_SEAM_OSC, (payload) => {
      fired++;
      seen = payload;
      return true;
    });
    await new Promise<void>((resolve) => t.write(`${seam}hello`, resolve));
    expect(fired, "seam OSC handler fired exactly once").toBe(1);
    expect(seen, "handler received the token payload").toBe("tok-abc123");
    // The seam emitted nothing: the following content starts at column 0, row 0.
    const norm = normalBuf(t);
    expect(norm.lines.get(0)?.translateToString(true)).toBe("hello");
    t.dispose();
  });
});
