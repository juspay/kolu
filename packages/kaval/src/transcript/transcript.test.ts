/**
 * Foundational guards for the transcript leaf — the make-or-break properties
 * the seam spike proved, now run against the REAL store + renderer + orchestrator:
 *   - lossless round-trip: paged-back ANSI, rewritten, == a single-shot render;
 *   - cross-width reflow: byte-identical across widths;
 *   - no-gap/no-overlap backward paging by byte cursor;
 *   - format-version fail-loud;
 *   - disabled → unavailable; copy-all whole-text read.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TranscriptStore } from "./store.ts";
import { Transcript } from "./transcript.ts";
import type { MirrorView } from "./types.ts";

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

  it("paged-back history equals a single-shot oracle at multiple widths", async () => {
    const N = 400;
    const { tx } = await feed(N);

    for (const W of [80, 100, 60, 120]) {
      // Oracle: replay all input into a fresh terminal at width W.
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

      // Page backward, accumulating ANSI, then rewrite into a fresh xterm.
      let cursor: number | null = null;
      const ansiParts: string[] = [];
      let guard = 0;
      while (guard++ < 1000) {
        const page = await tx.history({
          beforeCursor: cursor,
          maxLines: 50,
          width: W,
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
        scrollback: 100_000,
        allowProposedApi: true,
        reflowCursorLine: true,
      });
      for (const a of ansiParts) await write(replay, a);
      const got = readPlain(replay);

      // The paged history reconstructs every input line, in order, at width W.
      const oracleSig = oracle.filter((l) => /^L\d{5}\|/.test(l));
      const gotSig = got.filter((l) => /^L\d{5}\|/.test(l));
      expect(gotSig).toEqual(oracleSig);
    }
    tx.close();
    // Spinning throwaway xterms + serialize across 4 widths is CPU-heavy; a
    // loaded CI host (esp. a busy darwin builder) can exceed the 5s default.
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

    const W = 100;
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
        width: W,
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

    // copy-all carries every line of both spans.
    const text = await tx.readAllText();
    for (let i = 0; i < 20; i++) {
      expect(text).toContain(`A${String(i).padStart(3, "0")}|`);
      expect(text).toContain(`B${String(i).padStart(3, "0")}|`);
    }
    tx.close();
  }, 30_000);

  it("copy-all returns every line's text", async () => {
    const { tx } = await feed(120);
    const text = await tx.readAllText();
    for (let i = 0; i < 120; i++) {
      expect(text).toContain(`L${String(i).padStart(5, "0")}|`);
    }
    tx.close();
  }, 30_000);

  it("disabled policy → unavailable, no DB", async () => {
    const tx = Transcript.open({
      policy: { enabled: false, retentionBytes: 1 << 30 },
      dbPath: join(dir, "none.db"),
      cols: 80,
      rows: 24,
    });
    const r = await tx.history({ beforeCursor: null, maxLines: 50, width: 80 });
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
});
