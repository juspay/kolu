import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { Terminal as XTerm } from "@xterm/xterm";
import { Schema } from "effect";
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

const inserted = (rows: number): PrependResult => ({ kind: "inserted", rows });

function seamPayload(seam: string): string {
  return seam.slice(seam.indexOf(";") + 1, -1);
}

function headlessScratch(cols: number, rows: number): ScratchTerminal {
  return new HeadlessTerminal({
    cols,
    rows,
    scrollback: 100_000,
    allowProposedApi: true,
  }) as unknown as ScratchTerminal;
}
const makeScratch = headlessScratch;

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
    expect(m).toEqual({ kind: "inserted", rows: 32 });

    const b = normalBuf(live);
    expect(b.lines.length).toBe(before.len + 32);
    expect(b.lines.get(0)?.translateToString(true)).toBe("old-000");
    expect(b.lines.get(32)?.translateToString(true)).toBe("new-000");
    expect(b.lines.get(7)?.isWrapped).toBe(false);
    expect(b.lines.get(8)?.isWrapped).toBe(true);
    expect(b.lines.get(9)?.isWrapped).toBe(true);
    expect(b.ybase).toBe(before.ybase + 32);
    expect(b.ydisp).toBe(before.ydisp + 32);
    expect(viewportRows(live)).toEqual(before.viewport);

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
    const line = (live.buffer.active.getLine(15) as unknown as {
      translateToString(t?: boolean): string;
      getCell(i: number): { getFgColor(): number } | undefined;
    })!;
    expect(line.translateToString(true)).toBe("old-013-red");
    expect(line.getCell(0)?.getFgColor()).toBe(1);
  });

  it("THROWS when the prepend would overflow maxLength (no silent trim)", async () => {
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
    const one = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(one, "new-000\r\n");
    const beforeOne = normalBuf(one).lines.length;
    expect(await prependScrollback(one, "", 1, { makeScratch })).toEqual({
      kind: "inserted",
      rows: 1,
    });
    const bOne = normalBuf(one);
    expect(bOne.lines.length).toBe(beforeOne + 1);
    expect(bOne.lines.get(0)?.translateToString(true)).toBe("");
    expect(bOne.lines.get(1)?.translateToString(true)).toBe("new-000");

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
    await write(live, "\x1b[?1049h");
    expect(
      isAltBufferActive(
        live as unknown as { buffer: { active: { type: string } } },
      ),
    ).toBe(true);
    expect(
      await prependScrollback(live, olderChunk(), 0, { makeScratch }),
    ).toEqual({ kind: "skipped" });
  });

  it("keeps the SEAM row of a real serialize({range}) chunk (no trailing newline)", async () => {
    const mirror = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    const ser = new SerializeAddon();
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
    expect(chunk.endsWith("\n")).toBe(false);
    expect(chunk).toContain("h-14");

    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, "new-000\r\n");
    const m = await prependScrollback(live, chunk, 15, { makeScratch });
    expect(m).toEqual({ kind: "inserted", rows: 15 });
    const b = normalBuf(live);
    expect(b.lines.get(14)?.translateToString(true)).toBe("h-14");
    expect(b.lines.get(15)?.translateToString(true)).toBe("new-000");
  });

  it("materializes a range's trailing blank rows via servedRows (F10 fidelity)", async () => {
    const mirror = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    const ser = new SerializeAddon();
    (mirror as unknown as { loadAddon(a: SerializeAddon): void }).loadAddon(
      ser,
    );
    await write(mirror, "c-0\r\nc-1\r\nc-2\r\nc-3\r\nc-4\r\n\r\n\r\n");
    const span = 8;
    const chunk = ser.serialize({
      range: { start: 0, end: 7 },
      excludeModes: true,
      excludeAltBuffer: true,
    });

    const dropped = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(dropped, "new-000\r\n");
    expect(await prependScrollback(dropped, chunk, 0, { makeScratch })).toEqual(
      {
        kind: "inserted",
        rows: 7,
      },
    );

    const live = makeLive({ cols: COLS, rows: ROWS, scrollback: 1000 });
    await write(live, "new-000\r\n");
    const m = await prependScrollback(live, chunk, span, { makeScratch });
    expect(m).toEqual({ kind: "inserted", rows: span });
    const b = normalBuf(live);
    expect(b.lines.get(4)?.translateToString(true)).toBe("c-4");
    expect(b.lines.get(5)?.translateToString(true)).toBe("");
    expect(b.lines.get(6)?.translateToString(true)).toBe("");
    expect(b.lines.get(7)?.translateToString(true)).toBe("");
    expect(b.lines.get(8)?.translateToString(true)).toBe("new-000");
  });
});

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
      registerEscHandler: (_id: unknown, cb: () => boolean | undefined) => {
        escCb = cb;
        return { dispose() {} };
      },
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

class TerminalNotFound extends Schema.TaggedError<TerminalNotFound>(
  "xterm-kit-test/TerminalNotFound",
)("TerminalNotFound", { id: Schema.String }) {}

class PreviewTooLarge extends Schema.TaggedError<PreviewTooLarge>(
  "xterm-kit-test/PreviewTooLarge",
)("PreviewTooLarge", { bytes: Schema.Number }) {}

const GONE_TAG: string = new TerminalNotFound({ id: "" })._tag;
const isTerminalGone = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  "_tag" in err &&
  (err as { _tag: unknown })._tag === GONE_TAG;

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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledWith(100, expect.any(Number), undefined);
    expect(prepend).toHaveBeenCalledTimes(1);
    const shouldCommit = prepend.mock.calls[0]?.[2];
    expect(shouldCommit?.()).toBe(true);
    c.dispose();
  });

  it("reports each committed insert through onPrepended, with its row count", async () => {
    const f = fakeTerm();
    const onPrepended = vi.fn();
    const c = createBackfillController(f.term, {
      fetch: vi.fn(async () => chunk),
      prepend: vi.fn(async () => inserted(3)),
      isTerminalGone,
      onError: () => {},
      onPrepended,
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(onPrepended).toHaveBeenCalledWith(3);
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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    c.dispose();
    gate.resolve(chunk);
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).not.toHaveBeenCalled();
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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).toHaveBeenCalledTimes(1);
    f.setCols(40);
    f.fireResize();
    expect(seenShouldCommit?.()).toBe(false);
    prependGate.resolve({ kind: "skipped" });
    await new Promise((r) => setTimeout(r, 0));
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("echoes the seeded reflow epoch, and HALTS on a stale reply from a foreign reflow (F3)", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => ({ kind: "stale" as const }));
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100, 7);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledWith(100, expect.any(Number), 7);
    expect(prepend).not.toHaveBeenCalled();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("swallows a gone-terminal declared rejection (no toast), retryable after", async () => {
    const f = fakeTerm();
    const fetch = vi
      .fn<(before: number, max: number) => Promise<HistoryChunk>>()
      .mockRejectedValueOnce(new TerminalNotFound({ id: "t-1" }))
      .mockResolvedValueOnce(chunk);
    const prepend = vi.fn(async () => inserted(1));
    const onError = vi.fn();
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      isTerminalGone,
      onError,
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(prepend).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(prepend).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("surfaces a fetch fault the predicate rejects via onError (never a silent hole), retryable after", async () => {
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
      isTerminalGone,
      onError,
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(boom);
    expect(prepend).not.toHaveBeenCalled();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(prepend).toHaveBeenCalledTimes(1);
    c.dispose();
  });

  it("surfaces a DIFFERENT declared tagged error — the swallow keys on the tag, not on `is tagged`", async () => {
    const f = fakeTerm();
    const other = new PreviewTooLarge({ bytes: 1_000_000 });
    const fetch = vi
      .fn<(before: number, max: number) => Promise<HistoryChunk>>()
      .mockRejectedValueOnce(other);
    const onError = vi.fn();
    const c = createBackfillController(f.term, {
      fetch,
      prepend: vi.fn(async () => inserted(1)),
      isTerminalGone,
      onError,
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalledWith(other);
    c.dispose();
  });

  it("an alt-buffer switch DURING an in-flight fetch does NOT advance the cursor (no silent hole)", async () => {
    const f = fakeTerm();
    const gate = deferred<HistoryChunk>();
    const fetch = vi.fn(() => gate.promise);
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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledWith(100, expect.any(Number), undefined);
    f.setAltActive(true);
    gate.resolve(chunk);
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).toHaveBeenCalledTimes(1);
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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);

    const { commit, seam } = c.consumeSnapshotFrame(30, 2, true);
    gate.resolve(chunk);
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).not.toHaveBeenCalled();

    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);

    f.fireOsc(seamPayload(seam));
    f.fireRis();
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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenCalledTimes(1);

    f.fireRis();
    gate.resolve(chunk);
    await new Promise((r) => setTimeout(r, 0));
    expect(prepend).not.toHaveBeenCalled();

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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, false);
    f.fireOsc(seamPayload(seam));
    f.setCols(40);
    f.fireResize();
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, false);
    f.setCols(40);
    f.fireResize();
    f.fireOsc(seamPayload(seam));
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    c.dispose();
  });

  it("an overflow re-attach snapshot's OWN leading RIS does NOT revoke its committer — backfill resumes (F11)", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, true);
    f.fireOsc(seamPayload(seam));
    f.fireRis();
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(30, expect.any(Number), 2);

    f.fireRis();
    fetch.mockClear();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).not.toHaveBeenCalled();
    c.dispose();
  });

  it("a foreign RIS buffered AHEAD of a re-attach snapshot does NOT steal its seed — backfill resumes (F11 byte order)", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, true);
    f.fireRis();
    f.fireOsc(seamPayload(seam));
    f.fireRis();
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(30, expect.any(Number), 2);
    c.dispose();
  });

  it("an interleaved foreign RIS between two buffered snapshots — the NEWEST snapshot seeds (F11 byte order)", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
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
    f.fireOsc(seamPayload(seam1));
    f.fireRis();
    f.fireRis();
    f.fireOsc(seamPayload(seam2));
    f.fireRis();
    commit1();
    commit2();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(20, expect.any(Number), 3);
    c.dispose();
  });

  it("a foreign OSC on the seam ident (unmatched token) neither steals a pending seed nor throws (F12)", async () => {
    const f = fakeTerm();
    const fetch = vi.fn(async () => chunk);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    const { commit, seam } = c.consumeSnapshotFrame(30, 2, false);
    expect(f.fireOsc("60697-forged-by-a-program")).toBe(true);
    f.fireOsc(seamPayload(seam));
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(30, expect.any(Number), 2);
    c.dispose();
  });

  it("a foreign OSC on the seam ident with an EMPTY FIFO is ignored, not thrown (F12)", () => {
    const f = fakeTerm();
    const c = createBackfillController(f.term, {
      fetch: vi.fn(async () => chunk),
      prepend: vi.fn(async () => inserted(1)),
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    expect(() => f.fireOsc("anything")).not.toThrow();
    expect(f.fireOsc("anything")).toBe(true);
    c.dispose();
  });

  it("mints seam tokens without crypto.randomUUID — works in an insecure context (F14)", async () => {
    const originalDesc = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
    Object.defineProperty(crypto, "randomUUID", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(
        (crypto as { randomUUID?: unknown }).randomUUID,
        "the insecure-context sim must make randomUUID unavailable",
      ).toBeUndefined();
      const f = fakeTerm();
      const fetch = vi.fn(async () => chunk);
      const c = createBackfillController(f.term, {
        fetch,
        prepend: vi.fn(async () => inserted(1)),
        isTerminalGone,
        onError: () => {},
        onPrepended: () => {},
        triggerRows: 1e9,
      });
      const first = c.consumeSnapshotFrame(30, 2, false);
      const second = c.consumeSnapshotFrame(40, 2, false);
      const t1 = seamPayload(first.seam);
      const t2 = seamPayload(second.seam);
      expect(t1, "token is a 128-bit hex string").toMatch(/^[0-9a-f]{32}$/);
      expect(t2).toMatch(/^[0-9a-f]{32}$/);
      expect(t1, "each frame gets a distinct token").not.toBe(t2);
      f.fireOsc(t1);
      f.fireOsc(t2);
      second.commit();
      f.fireScroll();
      await new Promise((r) => setTimeout(r, 0));
      expect(fetch).toHaveBeenCalledWith(40, expect.any(Number), 2);
      c.dispose();
    } finally {
      if (originalDesc)
        Object.defineProperty(crypto, "randomUUID", originalDesc);
      else delete (crypto as { randomUUID?: unknown }).randomUUID;
    }
  });

  it("pages past an inserted-0 chunk instead of stalling (defensive loop)", async () => {
    const f = fakeTerm();
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
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    seedController(f, c, 100);
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
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
      const norm = normalBuf(scratch as unknown as XTerm);
      expect(norm.lines.get(0)?.translateToString(true)).toBe("hello");
      expect(norm.lines.get(1)?.translateToString(true)).toBe("world");
    } finally {
      scratch.dispose();
    }
  });

  it("a token-carrying seam is a no-op OSC that delivers the token payload and emits nothing", async () => {
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
    const norm = normalBuf(t);
    expect(norm.lines.get(0)?.translateToString(true)).toBe("hello");
    t.dispose();
  });
});

describe("backfill reset vs pending-seed FIFO", () => {
  it("reset() drops unparsed pending seeds so a later snapshot can re-seed", async () => {
    const history: HistoryChunk = {
      kind: "chunk",
      chunk: "x",
      topLine: 50,
      exhausted: false,
    };
    const f = fakeTerm();
    const fetch = vi.fn(async () => history);
    const prepend = vi.fn(async () => inserted(1));
    const c = createBackfillController(f.term, {
      fetch,
      prepend,
      isTerminalGone,
      onError: () => {},
      onPrepended: () => {},
      triggerRows: 1e9,
    });
    c.consumeSnapshotFrame(30, 2, false);
    c.reset();
    const { commit, seam } = c.consumeSnapshotFrame(40, 3, false);
    f.fireOsc(seamPayload(seam));
    commit();
    f.fireScroll();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetch).toHaveBeenLastCalledWith(40, expect.any(Number), 3);
    c.dispose();
  });
});
