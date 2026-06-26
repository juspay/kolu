/**
 * Foundational guards for the transcript leaf — the make-or-break properties
 * the seam spike proved, now run against the REAL store + renderer + orchestrator:
 *   - lossless round-trip: paged-back ANSI, rewritten, == a single-shot render;
 *   - cross-width reflow: byte-identical across widths;
 *   - no-gap/no-overlap backward paging by byte cursor;
 *   - format-version fail-loud;
 *   - disabled → unavailable.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializeFixedRows } from "./render.ts";
import { TranscriptStore } from "./store.ts";
import { Transcript } from "./transcript.ts";
import { type MirrorView, RecordKind } from "./types.ts";

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

const write = (t: InstanceType<typeof Terminal>, d: string): Promise<void> =>
  new Promise((r) => t.write(d, r));

/** A live headless mirror + a MirrorView over it, exactly as ptyHost will build. */
function makeMirror(cols: number, rows: number) {
  const term = new Terminal({
    cols,
    rows,
    scrollback: 100_000,
    allowProposedApi: true,
    reflowCursorLine: true,
  });
  const ser = new SerializeAddon();
  term.loadAddon(ser);
  const view: MirrorView = {
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    atCleanBoundary() {
      const b = term.buffer.active;
      return (
        b.type === "normal" &&
        b.cursorX === 0 &&
        !(b.getLine(b.baseY)?.isWrapped ?? false)
      );
    },
    cursorAtRowBoundary() {
      const b = term.buffer.active;
      return b.type === "normal" && (b.cursorX === 0 || b.cursorX >= term.cols);
    },
    serializeViewport() {
      return ser.serialize({ scrollback: 0 });
    },
  };
  return { term, view };
}

/** Read a terminal's buffer to trimmed plain rows (the comparison oracle). */
function readPlain(term: InstanceType<typeof Terminal>): string[] {
  const b = term.buffer.active;
  const rows: { t: string; w: boolean }[] = [];
  for (let i = 0; i < b.length; i++) {
    const l = b.getLine(i);
    rows.push({
      t: l?.translateToString(true) ?? "",
      w: l?.isWrapped ?? false,
    });
  }
  while (
    rows.length &&
    rows[rows.length - 1]!.t === "" &&
    !rows[rows.length - 1]!.w
  )
    rows.pop();
  return rows.map((r) => r.t);
}

/** Deterministic stream: sentinel-prefixed lines, some wrapping at 80, with a
 *  mid-stream resize (80→100) so reflow correctness is exercised. */
function buildStream(n: number): { chunks: string[]; resizeAfterLine: number } {
  const chunks: string[] = [];
  const resizeAfterLine = Math.floor(n / 2);
  for (let i = 0; i < n; i++) {
    const len = i % 5 === 0 ? 130 : 20 + (i % 40); // some wrap at 80
    const body = `L${String(i).padStart(5, "0")}|${"x".repeat(len)}`;
    // split each line across 1-2 chunks (escape-safe; plain text here)
    const mid = Math.floor(body.length / 2);
    chunks.push(body.slice(0, mid));
    chunks.push(`${body.slice(mid)}\r\n`);
  }
  return { chunks, resizeAfterLine };
}

describe("Transcript — lossless round-trip + cross-width paging", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kaval-tx-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function feed(n: number) {
    const dbPath = join(dir, "pty.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: 80,
      rows: 24,
      now: () => 1_700_000_000_000,
    });
    const { term: mirror, view } = makeMirror(80, 24);
    const { chunks } = buildStream(n);
    for (const c of chunks) {
      await write(mirror, c);
      tx.appendData(c, view);
    }
    return { tx, dbPath };
  }

  it("paged-back history equals a single-shot oracle at the capture width", async () => {
    // History renders FAITHFULLY at its historical width (never reflowed to a
    // reader), so the paged-back render must equal a single-shot render at the
    // CAPTURE width (80 — the mirror `feed` records at), and `page.contentWidth`
    // reports it. (The old test reflowed to 4 reader widths; that capability is
    // gone — replaying a stream at a foreign width is the corruption removed here.)
    const N = 400;
    const W = 80;
    const { tx } = await feed(N);

    // Oracle: replay all input into a fresh terminal at the capture width.
    const { chunks } = buildStream(N);
    const oracleTerm = new Terminal({
      cols: W,
      rows: 24,
      scrollback: 100_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const c of chunks) await write(oracleTerm, c);
    const oracle = readPlain(oracleTerm);

    // Page backward, accumulating ANSI, then rewrite into a fresh xterm at W.
    let cursor: number | null = null;
    const ansiParts: string[] = [];
    let guard = 0;
    while (guard++ < 1000) {
      const page = await tx.history({ beforeCursor: cursor, maxLines: 50 });
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") break;
      expect(page.contentWidth).toBe(W);
      ansiParts.unshift(page.ansi);
      if (page.atFloor) break;
      if (page.nextCursor >= (cursor ?? Number.POSITIVE_INFINITY)) break;
      cursor = page.nextCursor;
    }
    const replay = new Terminal({
      cols: W,
      rows: 24,
      scrollback: 100_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const a of ansiParts) await write(replay, a);
    const got = readPlain(replay);

    // The paged history reconstructs every input line, in order, at the width.
    const oracleSig = oracle.filter((l) => /^L\d{5}\|/.test(l));
    const gotSig = got.filter((l) => /^L\d{5}\|/.test(l));
    expect(gotSig).toEqual(oracleSig);
    tx.close();
  }, 60_000);

  it("crosses checkpoints: seed-drop telescoping still matches the oracle", async () => {
    // ~2400 lines × ~90 B ≈ 200 KB > 2× CHECKPOINT_BYTES, so several CKPTs fire
    // and backward paging must telescope checkpoint-spans (seed dropped each).
    const N = 2400;
    const dbPath = join(dir, "big.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: 80,
      rows: 24,
      now: () => 1_700_000_000_000,
    });
    const { term: mirror, view } = makeMirror(80, 24);
    const { chunks } = buildStream(N);
    for (const c of chunks) {
      await write(mirror, c);
      tx.appendData(c, view);
    }

    // A checkpoint must actually have been captured (the path under test).
    const store = TranscriptStore.open(dbPath);
    const ckpts = store.allRecords().filter((r) => r.kind === 2);
    store.close();
    expect(ckpts.length).toBeGreaterThanOrEqual(2);

    // Faithful render is at the CAPTURE width (80), so the oracle is too.
    const W = 80;
    const { chunks: oc } = buildStream(N);
    const oracleTerm = new Terminal({
      cols: W,
      rows: 24,
      scrollback: 200_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const c of oc) await write(oracleTerm, c);
    const oracleSig = readPlain(oracleTerm).filter((l) => /^L\d{5}\|/.test(l));

    let cursor: number | null = null;
    const ansiParts: string[] = [];
    let guard = 0;
    while (guard++ < 5000) {
      const page = await tx.history({
        beforeCursor: cursor,
        maxLines: 40,
      });
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") break;
      ansiParts.unshift(page.ansi);
      if (page.atFloor) break;
      if (page.nextCursor >= (cursor ?? Number.POSITIVE_INFINITY)) break;
      cursor = page.nextCursor;
    }
    const replay = new Terminal({
      cols: W,
      rows: 24,
      scrollback: 200_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const a of ansiParts) await write(replay, a);
    const gotSig = readPlain(replay).filter((l) => /^L\d{5}\|/.test(l));
    expect(gotSig).toEqual(oracleSig);
    tx.close();
  }, 30_000);

  it("faithful export freezes each resize-epoch at its historical width", async () => {
    // Span 1 at 80 cols, then a real mid-stream resize to 100, then span 2. Each
    // span's lines wrap (135 chars), so the wrap COLUMN differs by width — a
    // sensitive probe that a span is rendered at its own historical cols and not
    // re-wrapped to the final width (the F2 bug, where every span reflowed to the
    // last width / resizes landed only at the end).
    const dbPath = join(dir, "resize.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: 80,
      rows: 24,
      now: () => 1_700_000_000_000,
    });
    const { term: mirror, view } = makeMirror(80, 24);
    const span1: string[] = [];
    for (let i = 0; i < 20; i++) {
      const s = `A${String(i).padStart(3, "0")}|${"x".repeat(130)}\r\n`;
      span1.push(s);
      await write(mirror, s);
      tx.appendData(s, view);
    }
    // Out-of-band grid change — journaled on the transcript AND applied to the
    // live mirror, exactly as ptyHost.resize() does.
    mirror.resize(100, 24);
    tx.appendResize(100, 24);
    const span2: string[] = [];
    for (let i = 0; i < 20; i++) {
      const s = `B${String(i).padStart(3, "0")}|${"x".repeat(130)}\r\n`;
      span2.push(s);
      await write(mirror, s);
      tx.appendData(s, view);
    }

    const segs: { cols: number; rows: number; ansi: string }[] = [];
    for await (const seg of tx.exportSegments()) segs.push(seg);

    // One frozen segment per epoch: 80 then 100 (not a single collapsed segment).
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0]!.cols).toBe(80);
    expect(segs.at(-1)!.cols).toBe(100);

    // Oracle: span 1 rendered FROZEN at 80 (no later resize). The exported
    // segment, rewritten into a term at its own cols, must reproduce that exact
    // physical-row wrapping — which it would NOT if span 1 had reflowed to 100.
    const oracle1 = new Terminal({
      cols: 80,
      rows: 24,
      scrollback: 100_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const s of span1) await write(oracle1, s);
    const oracleRows1 = readPlain(oracle1);
    const replay1 = new Terminal({
      cols: segs[0]!.cols,
      rows: segs[0]!.rows,
      scrollback: 100_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    await write(replay1, segs[0]!.ansi);
    expect(readPlain(replay1)).toEqual(oracleRows1);

    tx.close();
  }, 30_000);

  it("splits a long resize-free epoch at checkpoint seams, still matching the oracle", async () => {
    // ~2400 lines × ~90 B ≈ 200 KB > 2× CHECKPOINT_BYTES with NO resize: one
    // epoch, so the OLD shape would inflate the whole 200 KB into a single export
    // segment (the F1 OOM shape). It must instead split at the same-width
    // checkpoint seams — multiple bounded segments whose concatenated render still
    // equals a single-shot oracle.
    const N = 2400;
    const dbPath = join(dir, "epoch.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: 80,
      rows: 24,
      now: () => 1_700_000_000_000,
    });
    const { term: mirror, view } = makeMirror(80, 24);
    // A constant-width stream (NO resize) — feed buildStream's chunks but never
    // call appendResize, so the whole run is one resize-epoch.
    const { chunks } = buildStream(N);
    for (const c of chunks) {
      await write(mirror, c);
      tx.appendData(c, view);
    }

    const segs: { cols: number; rows: number; ansi: string }[] = [];
    for await (const seg of tx.exportSegments()) segs.push(seg);

    // Bounded: the single epoch is split into several segments, all at 80 cols.
    expect(segs.length).toBeGreaterThanOrEqual(2);
    for (const s of segs) expect(s.cols).toBe(80);

    // Concatenating every segment's ANSI reproduces a single-shot oracle at 80.
    const oracle = new Terminal({
      cols: 80,
      rows: 24,
      scrollback: 200_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const c of buildStream(N).chunks) await write(oracle, c);
    const oracleSig = readPlain(oracle).filter((l) => /^L\d{5}\|/.test(l));

    const replay = new Terminal({
      cols: 80,
      rows: 24,
      scrollback: 200_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const s of segs) await write(replay, s.ansi);
    const gotSig = readPlain(replay).filter((l) => /^L\d{5}\|/.test(l));
    expect(gotSig).toEqual(oracleSig);
    tx.close();
  }, 30_000);

  it("disabled policy → unavailable, no DB", async () => {
    const tx = Transcript.open({
      policy: { enabled: false, retentionBytes: 1 << 30 },
      dbPath: join(dir, "none.db"),
      cols: 80,
      rows: 24,
    });
    const r = await tx.history({ beforeCursor: null, maxLines: 50 });
    expect(r.kind).toBe("unavailable");
    tx.close();
  });

  it("fails loud on an unknown on-disk format version", async () => {
    const dbPath = join(dir, "bad.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: 80,
      rows: 24,
    });
    tx.close();
    // Corrupt the format version, then reopening must throw, not silently read.
    const raw = TranscriptStore.open(dbPath);
    // bump via a fresh connection
    rmSync(join(dir, "x"), { force: true });
    raw.close();
    // simulate a future schema by writing a different version directly
    const { DatabaseSync } =
      require("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE meta SET value=? WHERE key='formatVersion'").run("999");
    db.close();
    expect(() => TranscriptStore.open(dbPath)).toThrow(
      /unknown on-disk format/,
    );
  });

  /** Feed `n` lines under a TINY retention cap so eviction actually fires (the
   *  floor rises above byte 0), and return the tx plus the live floor. */
  async function feedEvicted(n: number, retentionBytes: number) {
    const dbPath = join(dir, "evict.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes },
      dbPath,
      cols: 80,
      rows: 24,
      now: () => 1_700_000_000_000,
    });
    const { term: mirror, view } = makeMirror(80, 24);
    for (const c of buildStream(n).chunks) {
      await write(mirror, c);
      tx.appendData(c, view);
    }
    // A second WAL reader observes the post-eviction floor (the tx owns its own
    // connection; node:sqlite WAL allows a concurrent reader).
    const store = TranscriptStore.open(dbPath);
    const floor = store.oldestByteSeq();
    store.close();
    return { tx, floor };
  }

  it("paging to an EVICTED floor reports floorEvicted (≠ genuine start) — F4", async () => {
    const { tx, floor } = await feedEvicted(2400, 600);
    // Retention actually trimmed older records — the floor is above byte 0.
    expect(floor).toBeGreaterThan(0);

    let cursor: number | null = null;
    let last: Awaited<ReturnType<typeof tx.history>> | undefined;
    let guard = 0;
    while (guard++ < 2000) {
      const page = await tx.history({
        beforeCursor: cursor,
        maxLines: 50,
      });
      last = page;
      if (page.kind !== "ok") break;
      if (page.atFloor) break;
      cursor = page.nextCursor;
    }
    expect(last?.kind).toBe("ok");
    if (last?.kind === "ok") {
      expect(last.atFloor).toBe(true);
      // The honest distinction: this floor is the eviction watermark, NOT the
      // beginning of the session — so the pager shows "older trimmed".
      expect(last.floorEvicted).toBe(true);
    }
    tx.close();
  }, 30_000);

  it("paging to the GENUINE start reports floorEvicted=false", async () => {
    const N = 200;
    const { tx } = await (async () => {
      const dbPath = join(dir, "genuine.db");
      const t = Transcript.open({
        policy: { enabled: true, retentionBytes: 1 << 30 }, // no eviction
        dbPath,
        cols: 80,
        rows: 24,
        now: () => 1_700_000_000_000,
      });
      const { term: mirror, view } = makeMirror(80, 24);
      for (const c of buildStream(N).chunks) {
        await write(mirror, c);
        t.appendData(c, view);
      }
      return { tx: t };
    })();
    let cursor: number | null = null;
    let last: Awaited<ReturnType<typeof tx.history>> | undefined;
    let guard = 0;
    while (guard++ < 2000) {
      const page = await tx.history({
        beforeCursor: cursor,
        maxLines: 50,
      });
      last = page;
      if (page.kind !== "ok") break;
      if (page.atFloor) break;
      cursor = page.nextCursor;
    }
    expect(last?.kind).toBe("ok");
    if (last?.kind === "ok") {
      expect(last.atFloor).toBe(true);
      expect(last.floorEvicted).toBe(false); // genuine beginning of session
    }
    tx.close();
  }, 30_000);

  it("searchHistory below / down to the eviction floor returns evicted — F3", async () => {
    const { tx, floor } = await feedEvicted(2400, 600);
    expect(floor).toBeGreaterThan(0);

    // (a) A sub-floor RESUME (a stale cursor the floor has risen past) is NOT an
    // exhausted search — it must surface `evicted`, never an empty-complete page.
    const resume = await tx.searchHistory({
      query: "L0",
      beforeCursor: Math.max(0, floor - 1),
      caseSensitive: false,
      maxResults: 500,
    });
    expect(resume.evicted).toBe(true);
    expect(resume.nextCursor).toBeNull();

    // (b) A fresh search that scans the whole RETAINED history down to the floor
    // is likewise non-exhaustive (older matches were trimmed) → evicted.
    const fresh = await tx.searchHistory({
      query: "L0",
      beforeCursor: null,
      caseSensitive: false,
      maxResults: 500,
    });
    expect(fresh.evicted).toBe(true);
    tx.close();
  }, 30_000);

  it("a forced row-boundary checkpoint seam does not duplicate/split the line — F5", async () => {
    // Emit > MAX_CHECKPOINT_GAP_BYTES (16×64KB = 1 MiB) with NO newline, so no
    // clean LINE boundary is ever reached and a checkpoint is FORCED. xterm's
    // deferred wrap parks the cursor at cursorX===cols (never 0) on each completed
    // physical row, so cursorAtRowBoundary() fires there and the force lands at a
    // ROW boundary; seedBoundaryRow's `+1` then attributes the completed seam row
    // to exactly one span. Paging across the seam at the SAME width must reproduce
    // a single-shot render with NO duplicated/split row — and the seam must really
    // exist (a forced CKPT past byte 0), or the test proves nothing.
    const dbPath = join(dir, "midline.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: 80,
      rows: 24,
      now: () => 1_700_000_000_000,
    });
    const { term: mirror, view } = makeMirror(80, 24);
    // ~1.15 MiB of newline-free, marker-bearing content (so any duplicated slice
    // is detectable), fed in odd-sized chunks; the next completed-row boundary
    // after 1 MiB triggers the forced checkpoint.
    const total = 1_150_000;
    const chunkLen = 997;
    let written = 0;
    let k = 0;
    while (written < total) {
      const len = Math.min(chunkLen, total - written);
      // A rolling marker every 10 chars keeps the long line non-degenerate.
      let s = "";
      for (let i = 0; i < len; i++)
        s += (written + i) % 10 === 0 ? String((k++ % 36).toString(36)) : "x";
      await write(mirror, s);
      tx.appendData(s, view);
      written += len;
    }

    // Oracle: the same stream into a fresh terminal at width 80.
    const oracle = new Terminal({
      cols: 80,
      rows: 24,
      scrollback: 200_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    // Rebuild the identical byte stream for the oracle.
    {
      let w = 0;
      let kk = 0;
      while (w < total) {
        const len = Math.min(chunkLen, total - w);
        let s = "";
        for (let i = 0; i < len; i++)
          s += (w + i) % 10 === 0 ? String((kk++ % 36).toString(36)) : "x";
        await write(oracle, s);
        w += len;
      }
    }
    const oracleRows = readPlain(oracle);

    // Page backward at width 80 (same width — isolates the duplicate from the
    // documented cross-width reflow imprecision of a forced mid-line seed).
    let cursor: number | null = null;
    const ansiParts: string[] = [];
    let guard = 0;
    while (guard++ < 5000) {
      const page = await tx.history({
        beforeCursor: cursor,
        maxLines: 200,
      });
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") break;
      ansiParts.unshift(page.ansi);
      if (page.atFloor) break;
      cursor = page.nextCursor;
    }
    const replay = new Terminal({
      cols: 80,
      rows: 24,
      scrollback: 200_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const a of ansiParts) await write(replay, a);
    const gotRows = readPlain(replay);

    // No duplicated/split row at the seam: the reassembled rows match the oracle
    // exactly (same count, same content).
    expect(gotRows.length).toBe(oracleRows.length);
    expect(gotRows).toEqual(oracleRows);
    tx.close();

    // Non-vacuousness: a checkpoint was actually FORCED past byte 0 (not just the
    // implicit byte-0 seed), so the paging above genuinely crossed a forced seam.
    // Before the #5 fix this stream produced NO forced checkpoint (the dead
    // column-0 detector never fired and the stream stayed under the HARD ceiling),
    // so the seam test passed without exercising a seam at all.
    const store = TranscriptStore.open(dbPath);
    const forcedCkpts = store
      .allRecords()
      .filter((r) => r.kind === RecordKind.CKPT && r.firstByteSeq > 0);
    store.close();
    expect(forcedCkpts.length).toBeGreaterThan(0);
  }, 60_000);

  it("a SECOND distinct write-fault cause still reaches onFault (not swallowed by the latch) — F6", async () => {
    const { DatabaseSync } =
      require("node:sqlite") as typeof import("node:sqlite");
    const dbPath = join(dir, "twofault.db");
    const faults: string[] = [];
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: 80,
      rows: 24,
      now: () => 1_700_000_000_000,
      onFault: (err) =>
        faults.push(err instanceof Error ? err.message : String(err)),
    });
    const { view } = makeMirror(80, 24);
    tx.appendData("seed\r\n", view); // buffered, not yet flushed

    // Cause A: drop the table out from under the connection → the next flush's
    // INSERT throws "no such table".
    const c1 = new DatabaseSync(dbPath);
    c1.exec("DROP TABLE record");
    c1.close();
    tx.appendData("a".repeat(70_000), view); // forces a flush → fault A

    // Cause B (DISTINCT): recreate `record` with a CHECK that the insert violates
    // → close()'s flush-retry throws a DIFFERENT message.
    const c2 = new DatabaseSync(dbPath);
    c2.exec(
      "CREATE TABLE record(seq INTEGER PRIMARY KEY, kind INTEGER, firstByteSeq INTEGER, byteLen INTEGER, tsMs INTEGER, cols INTEGER, rows INTEGER, payload BLOB, CHECK(seq < 0))",
    );
    c2.close();
    tx.close(); // flush-retry → CHECK fails → fault B

    expect(faults.length).toBe(2); // BOTH distinct causes surfaced (old code: 1)
    expect(new Set(faults).size).toBe(2); // genuinely different messages
  }, 30_000);

  it("serializeFixedRows is width-locked and colour-faithful", async () => {
    // A coloured stream with an in-place `\r` redraw, emitted for width 120.
    const W = 120;
    const stream =
      "\x1b[32mgreen\x1b[0m plain \x1b[1;31mbold red\x1b[0m tail\r\n" +
      "Germinating... thinking with xhigh effort and a long tail beyond ninety\r" +
      "Germinating... \x1b[33mdone\x1b[0m\r\n";
    const src = new Terminal({
      cols: W,
      rows: 24,
      scrollback: 10_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    await write(src, stream);
    const fixed = serializeFixedRows(src, 0);

    // Written at the emit width AND at double width, the rows are IDENTICAL — a
    // fixed-row render does not re-wrap (the property the whole fix rests on).
    const mk = (cols: number) => {
      const t = new Terminal({
        cols,
        rows: 24,
        scrollback: 10_000,
        allowProposedApi: true,
        reflowCursorLine: true,
      });
      return t;
    };
    const a = mk(W);
    const b = mk(W * 2);
    await write(a, fixed);
    await write(b, fixed);
    const ra = readPlain(a);
    const rb = readPlain(b);
    expect(ra).toEqual(rb); // width-locked
    expect(ra).toEqual(readPlain(src)); // faithful to the source (redraw resolved)

    // Colour fidelity: the per-cell fg/bold signature survives the round-trip.
    const sig = (t: InstanceType<typeof Terminal>): string[] => {
      const buf = t.buffer.active;
      const cell = buf.getNullCell();
      const out: string[] = [];
      for (let y = 0; y < buf.length; y++) {
        const line = buf.getLine(y);
        if (!line) continue;
        let s = "";
        for (let x = 0; x < line.length; x++) {
          line.getCell(x, cell);
          if (cell.getChars() === "" && cell.isBgDefault()) continue;
          s += `${cell.getChars() || " "}@${cell.isFgPalette() ? `p${cell.getFgColor()}` : cell.isFgRGB() ? `r${cell.getFgColor()}` : "d"}${cell.isBold() ? "b" : ""}`;
        }
        if (s) out.push(s);
      }
      return out;
    };
    expect(sig(a)).toEqual(sig(src));
  });

  it("history() renders a TUI redraw faithfully, not reflowed mush", async () => {
    // THE production-bug regression guard. Record a cursor-addressed TUI stream
    // (`\r` in-place redraws — Claude Code's spinner/input box) at width 120, then
    // page it back. The rendered page must equal the LIVE screen at the historical
    // width 120 — NOT a reflowed mush. Under the old renderReflow (replay at the
    // reader's width) the `\r` would land on the wrong physical row and corrupt;
    // the faithful fixed-row render keeps it byte-exact.
    const W = 120;
    const dbPath = join(dir, "tui.db");
    const tx = Transcript.open({
      policy: { enabled: true, retentionBytes: 1 << 30 },
      dbPath,
      cols: W,
      rows: 24,
      now: () => 1_700_000_000_000,
    });
    const { term: mirror, view } = makeMirror(W, 24);
    // Several redraw lines that each WRAP at a narrower width (so a foreign-width
    // replay would mis-place the `\r`) — proof the page is at the historical width.
    const lines = [
      "Refocusing on the concrete deliverable: the draft PR with all the plan changes here ok now done yes\rRefocusing... almost done\r\n",
      "Germinating... thinking with xhigh effort and a very long tail to push beyond ninety columns wide\rGerminating... done\r\n",
      "bypass permissions on (shift+tab to cycle) -- esc to interrupt -- a normal trailing line that is fine\r\n",
    ];
    for (const l of lines) {
      await write(mirror, l);
      tx.appendData(l, view);
    }
    const live = readPlain(mirror); // the faithful final screen at width 120

    let cursor: number | null = null;
    const ansiParts: string[] = [];
    let guard = 0;
    while (guard++ < 1000) {
      const page = await tx.history({ beforeCursor: cursor, maxLines: 50 });
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") break;
      expect(page.contentWidth).toBe(W); // rendered at the HISTORICAL width
      ansiParts.unshift(page.ansi);
      if (page.atFloor) break;
      cursor = page.nextCursor;
    }
    const replay = new Terminal({
      cols: W,
      rows: 24,
      scrollback: 10_000,
      allowProposedApi: true,
      reflowCursorLine: true,
    });
    for (const a of ansiParts) await write(replay, a);
    expect(readPlain(replay)).toEqual(live); // faithful, no redraw corruption
    tx.close();
  }, 30_000);
});
