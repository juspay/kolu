/**
 * `Transcript` — the per-PTY orchestrator that turns one terminal's decoded
 * output stream into a lossless, seekable on-disk history, and serves it back.
 *
 * WRITE path (driven by the existing `proc.onData` callback, so it shares the
 * mirror's byte stream and inherits attach's race-freedom): coalesce output into
 * ~64 KB zstd DATA blocks, journal RESIZE at its true stream position, and every
 * ~64 KB capture a CKPT (`serialize({ scrollback: 0 })`) DEFERRED to the next
 * clean line boundary — the constraint that makes cross-width reflow byte-exact.
 *
 * READ path: `history` pages backward by opaque byte cursor (checkpoint-to-
 * checkpoint), `exportHistory` renders faithfully per resize-epoch, `searchHistory`
 * replays-and-scans by logical line. All reads run behind the renderer's
 * semaphore.
 *
 * Survivability outranks fail-fast for ONE thing: a runtime disk fault degrades
 * THIS terminal's transcript to a surfaced `faulted` state (never a truncated
 * log shown as complete, never a daemon crash) — the PTY keeps running.
 */

import { zstdCompressSync } from "node:zlib";
import {
  type CheckpointRow,
  type ResumeState,
  TranscriptStore,
} from "./store.ts";
import { renderFaithful, renderReflow } from "./render.ts";
import {
  BLOCK_BYTES,
  CHECKPOINT_BYTES,
  type HistoryPolicy,
  type MirrorView,
  type Row,
  RecordKind,
  type Seq,
} from "./types.ts";

/** A backward history page, or one of the honest non-content states (never
 *  silent-empty). `ansi` writes into the pager's read-only xterm; `nextCursor`
 *  is the reflow-stable byte cursor for the next page up. */
export type HistoryResult =
  | {
      kind: "ok";
      ansi: string;
      rowCount: number;
      nextCursor: Seq;
      atFloor: boolean;
      firstRow: Row;
    }
  | { kind: "unavailable" }
  | { kind: "evicted" }
  | { kind: "faulted"; lastGoodSeq: number };

/** One faithful per-resize-epoch export segment: the client resizes its
 *  offscreen themed xterm to `(cols, rows)`, writes `ansi`, and accumulates the
 *  themed HTML. Historical-per-span width — a 200-col table is never re-wrapped. */
export interface ExportSegment {
  cols: number;
  rows: number;
  ansi: string;
}

/** A search hit, newest-first. `cursor` feeds `history()` so the pager opens at
 *  the match's span; `matches` are per-logical-line offsets for in-view paint. */
export interface SearchMatch {
  cursor: Seq;
  firstRow: Row;
  text: string;
  matches: { start: number; end: number }[];
}

export interface SearchResult {
  hits: SearchMatch[];
  nextCursor: Seq | null;
  truncated: boolean;
}

export interface TranscriptStatus {
  enabled: boolean;
  faulted: boolean;
  lastGoodSeq: number;
  tipByteSeq: Seq;
  oldestByteSeq: Seq;
}

const SEARCH_HARD_CAP = 1000;

function countNewlines(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10) n++;
  return n;
}

export class Transcript {
  private store: TranscriptStore | null = null;
  private seq = 0;
  private byteSeq: Seq = 0;
  private row: Row = 0;
  private cols: number;
  private rows: number;

  // Pending coalesce buffer (decoded output not yet flushed to a DATA block).
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private pendingStartByteSeq: Seq = 0;
  private pendingStartRow: Row = 0;
  private bytesSinceCheckpoint = 0;

  private fault: { lastGoodSeq: number } | null = null;

  private constructor(
    private readonly policy: HistoryPolicy,
    cols: number,
    rows: number,
    private readonly now: () => number,
  ) {
    this.cols = cols;
    this.rows = rows;
  }

  /** Open (or resume) a transcript. `enabled: false` writes no DB; reads return
   *  `unavailable`. A reopen (cold restore / wake on the same id) continues the
   *  seq/byteSeq/row counters from the persisted max — appended history. */
  static open(args: {
    policy: HistoryPolicy;
    dbPath: string;
    cols: number;
    rows: number;
    now?: () => number;
  }): Transcript {
    const t = new Transcript(
      args.policy,
      args.cols,
      args.rows,
      args.now ?? Date.now,
    );
    if (args.policy.enabled) {
      const store = TranscriptStore.open(args.dbPath);
      const resume: ResumeState = store.resumeState();
      t.store = store;
      t.seq = resume.maxSeq;
      t.byteSeq = resume.tipByteSeq;
      t.row = resume.tipRow;
    }
    return t;
  }

  // ---- WRITE path ---------------------------------------------------------

  /** Append decoded PTY output. Called from `proc.onData`'s post-parse callback,
   *  so the mirror reflects `data` and `mirror.atCleanBoundary()` is current. */
  appendData(data: string, mirror: MirrorView): void {
    if (!this.store || this.fault) return;
    this.cols = mirror.cols;
    this.rows = mirror.rows;
    const bytes = Buffer.byteLength(data, "utf8");
    if (this.pending.length === 0) {
      this.pendingStartByteSeq = this.byteSeq;
      this.pendingStartRow = this.row;
    }
    this.pending.push(Buffer.from(data, "utf8"));
    this.pendingBytes += bytes;
    this.byteSeq += bytes;
    this.row += countNewlines(data);
    this.bytesSinceCheckpoint += bytes;
    try {
      if (mirror.atCleanBoundary() && this.bytesSinceCheckpoint >= CHECKPOINT_BYTES) {
        this.flushPending();
        this.captureCheckpoint(mirror);
        this.bytesSinceCheckpoint = 0;
      } else if (this.pendingBytes >= BLOCK_BYTES) {
        this.flushPending();
      }
      this.maybeEvict();
    } catch (err) {
      this.handleFault(err);
    }
  }

  /** Journal a grid change at its true stream position — the load-bearing
   *  RESIZE record (the seam spike's negative control). */
  appendResize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    if (!this.store || this.fault) return;
    try {
      this.flushPending();
      this.store.append({
        seq: ++this.seq,
        kind: RecordKind.RESIZE,
        firstRow: this.row,
        firstByteSeq: this.byteSeq,
        byteLen: 0,
        tsMs: this.now(),
        cols,
        rows,
        payload: null,
      });
    } catch (err) {
      this.handleFault(err);
    }
  }

  private flushPending(): void {
    if (!this.store || this.pending.length === 0) return;
    const decoded = Buffer.concat(this.pending);
    const payload = zstdCompressSync(decoded);
    this.store.append({
      seq: ++this.seq,
      kind: RecordKind.DATA,
      firstRow: this.pendingStartRow,
      firstByteSeq: this.pendingStartByteSeq,
      byteLen: this.pendingBytes,
      tsMs: this.now(),
      cols: this.cols,
      rows: this.rows,
      payload,
    });
    this.pending = [];
    this.pendingBytes = 0;
  }

  private captureCheckpoint(mirror: MirrorView): void {
    if (!this.store) return;
    const seed = Buffer.from(mirror.serializeViewport(), "utf8");
    this.store.append({
      seq: ++this.seq,
      kind: RecordKind.CKPT,
      firstRow: this.row,
      firstByteSeq: this.byteSeq,
      byteLen: 0,
      tsMs: this.now(),
      cols: mirror.cols,
      rows: mirror.rows,
      payload: zstdCompressSync(seed),
    });
  }

  private maybeEvict(): void {
    if (!this.store) return;
    const cutoff = this.store.evictionCheckpoint(this.policy.retentionBytes);
    if (cutoff !== undefined && cutoff > 0) this.store.evictBefore(cutoff);
  }

  private handleFault(err: unknown): void {
    if (this.fault) return;
    this.fault = { lastGoodSeq: this.seq };
    // Surfaced via status(); the PTY keeps running. The one place survivability
    // outranks fail-fast (caught-error-must-not-collapse-to-empty: we surface
    // `faulted`, never present a truncated log as complete).
  }

  // ---- READ path ----------------------------------------------------------

  /** The current stream tip — the pager opens its first page at this cursor. */
  tipByteSeq(): Seq {
    return this.byteSeq;
  }

  status(): TranscriptStatus {
    return {
      enabled: this.policy.enabled,
      faulted: this.fault !== null,
      lastGoodSeq: this.fault?.lastGoodSeq ?? this.seq,
      tipByteSeq: this.byteSeq,
      oldestByteSeq: this.store?.oldestByteSeq() ?? 0,
    };
  }

  /** One backward page ending at `beforeCursor` (or the tip when null),
   *  accumulating checkpoint-spans until ≥ `maxLines` rows or the floor. */
  async history(args: {
    beforeCursor: Seq | null;
    maxLines: number;
    width: number;
  }): Promise<HistoryResult> {
    if (!this.policy.enabled) return { kind: "unavailable" };
    if (this.fault) return { kind: "faulted", lastGoodSeq: this.fault.lastGoodSeq };
    if (!this.store) return { kind: "unavailable" };
    this.flushPending();
    const tip = this.byteSeq;
    let cursor = args.beforeCursor ?? tip;
    const oldest = this.store.oldestByteSeq();
    if (cursor <= oldest && oldest > 0) return { kind: "evicted" };
    const ansiParts: string[] = [];
    let rowCount = 0;
    let firstRow = this.row;
    let atFloor = false;
    while (true) {
      const seed = this.store.latestCheckpointBefore(cursor);
      const from = seed ? seed.firstByteSeq : 0;
      const blocks = this.store.dataInRange(from, cursor);
      const seg = await renderReflow(seed, args.width, blocks);
      ansiParts.unshift(seg.ansi);
      rowCount += seg.rows.length;
      cursor = from;
      if (!seed || cursor <= oldest) {
        atFloor = true;
        break;
      }
      if (rowCount >= args.maxLines) break;
    }
    firstRow = Math.max(0, firstRow);
    return {
      kind: "ok",
      ansi: ansiParts.join(""),
      rowCount,
      nextCursor: cursor,
      atFloor,
      firstRow,
    };
  }

  /** Whole-transcript plain text, faithful per resize-epoch — the source both
   *  "Copy terminal text" and the pager's "Copy all history" read. */
  async readAllText(): Promise<string> {
    if (!this.store) return "";
    this.flushPending();
    const lines: string[] = [];
    for await (const seg of this.faithfulSegments(0, this.byteSeq)) {
      // Re-render each segment to plain rows via the same machinery.
      const rendered = await renderFaithful(seg.seed, seg.cols, seg.events);
      for (const r of rendered.rows) lines.push(r.text);
    }
    return lines.join("\n");
  }

  /** Stream faithful export segments oldest→newest (one per resize-epoch),
   *  each rendered at its historical width. */
  async *exportSegments(): AsyncIterable<ExportSegment> {
    if (!this.store) return;
    this.flushPending();
    for await (const seg of this.faithfulSegments(0, this.byteSeq)) {
      const rendered = await renderFaithful(seg.seed, seg.cols, seg.events);
      yield { cols: seg.cols, rows: seg.rows, ansi: rendered.ansi };
    }
  }

  /** Search the transcript newest-first by replaying spans and joining wrapped
   *  rows into logical lines (width-independent matching). */
  async searchHistory(args: {
    query: string;
    beforeCursor: Seq | null;
    regex: boolean;
    caseSensitive: boolean;
    maxResults: number;
  }): Promise<SearchResult> {
    if (!this.store || !this.policy.enabled) {
      return { hits: [], nextCursor: null, truncated: false };
    }
    this.flushPending();
    const cap = Math.min(args.maxResults, SEARCH_HARD_CAP);
    const test = compileMatcher(args.query, args.regex, args.caseSensitive);
    const hits: SearchMatch[] = [];
    let cursor = args.beforeCursor ?? this.byteSeq;
    const oldest = this.store.oldestByteSeq();
    let truncated = false;
    let nextCursor: Seq | null = null;
    while (cursor > oldest) {
      const seed = this.store.latestCheckpointBefore(cursor);
      const from = seed ? seed.firstByteSeq : 0;
      const blocks = this.store.dataInRange(from, cursor);
      const seg = await renderReflow(seed, this.cols || 80, blocks);
      // Join wrapped continuation rows into logical lines (newest-first within
      // the span so global order stays newest-first).
      const logical = joinLogical(seg.rows);
      for (let i = logical.length - 1; i >= 0; i--) {
        const m = test(logical[i]!);
        if (m.length > 0) {
          hits.push({ cursor, firstRow: 0, text: logical[i]!, matches: m });
          if (hits.length >= cap) {
            truncated = true;
            nextCursor = from;
            return { hits, nextCursor, truncated };
          }
        }
      }
      cursor = from;
      if (!seed) break;
    }
    return { hits, nextCursor, truncated };
  }

  // ---- internals ----------------------------------------------------------

  /** Assemble faithful render inputs per resize-epoch over `[from, to)`. Each
   *  yielded segment seeds from the nearest checkpoint and carries its DATA +
   *  RESIZE events in byte order; the renderer applies the resizes. */
  private async *faithfulSegments(
    from: Seq,
    to: Seq,
  ): AsyncIterable<{
    seed: CheckpointRow | undefined;
    cols: number;
    rows: number;
    events: Array<
      | { kind: "data"; payload: Uint8Array }
      | { kind: "resize"; cols: number; rows: number }
    >;
  }> {
    if (!this.store || to <= from) return;
    const seed = this.store.latestCheckpointAtOrBefore(from === 0 ? 0 : from);
    const start = seed ? seed.firstByteSeq : 0;
    const dataBlocks = this.store.dataInRange(start, to);
    const resizes = this.store.resizesInRange(start, to);
    // Merge DATA + RESIZE in byte order. dataInRange is already ordered; we
    // approximate interleaving by RESIZE byteSeq vs the cumulative data — for a
    // faithful export the renderer applies resizes between data flushes.
    const events: Array<
      | { kind: "data"; payload: Uint8Array }
      | { kind: "resize"; cols: number; rows: number }
    > = [];
    for (const b of dataBlocks) events.push({ kind: "data", payload: b });
    for (const r of resizes)
      events.push({ kind: "resize", cols: r.cols, rows: r.rows });
    yield {
      seed,
      cols: seed?.cols ?? this.cols,
      rows: seed?.rows ?? this.rows,
      events,
    };
  }

  close(): void {
    try {
      this.flushPending();
    } catch (err) {
      this.handleFault(err);
    }
    this.store?.close();
    this.store = null;
  }
}

/** Join wrapped continuation rows into logical lines. */
function joinLogical(rows: { text: string; wrapped: boolean }[]): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (r.wrapped && out.length > 0) out[out.length - 1] += r.text;
    else out.push(r.text);
  }
  return out;
}

/** Compile a per-logical-line matcher. Default literal + case-insensitive
 *  (exactly what the find bar does today); regex/case are opt-in capabilities
 *  (reuse the source of truth — xterm's ISearchOptions shape), not knobs. */
function compileMatcher(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): (line: string) => { start: number; end: number }[] {
  if (regex) {
    const re = new RegExp(query, caseSensitive ? "g" : "gi");
    return (line) => {
      const out: { start: number; end: number }[] = [];
      for (const m of line.matchAll(re)) {
        if (m.index === undefined) continue;
        out.push({ start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }
      return out;
    };
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return (line) => {
    if (needle.length === 0) return [];
    const hay = caseSensitive ? line : line.toLowerCase();
    const out: { start: number; end: number }[] = [];
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push({ start: i, end: i + needle.length });
      i = hay.indexOf(needle, i + needle.length);
    }
    return out;
  };
}
