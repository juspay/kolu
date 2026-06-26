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
import { renderFaithful, renderReflow } from "./render.ts";
import {
  type CheckpointRow,
  type ResumeState,
  TranscriptStore,
} from "./store.ts";
import {
  BLOCK_BYTES,
  CHECKPOINT_BYTES,
  type HistoryPolicy,
  MAX_CHECKPOINT_GAP_BYTES,
  type MirrorView,
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
      nextCursor: Seq;
      atFloor: boolean;
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
 *  the match's span; the client's SearchAddon re-finds the offsets in-view, so
 *  the server records only the span cursor. */
export interface SearchMatch {
  cursor: Seq;
}

export interface SearchResult {
  hits: SearchMatch[];
  nextCursor: Seq | null;
  truncated: boolean;
}

const SEARCH_HARD_CAP = 1000;

/** Wall-clock budget for one `searchHistory` request. A regex search runs
 *  user-supplied patterns across the replayed transcript on the single-threaded
 *  daemon; a slow-but-benign pattern over a large history (or a mildly
 *  backtracking one spread across many lines) would otherwise block live output
 *  for every terminal this host owns. When the budget is spent we stop at the
 *  current span and return a `truncated` page with a resume cursor — the same
 *  honest soft-cap shape `SEARCH_HARD_CAP` already uses, never a silent partial.
 *  This bounds the realistic "regex over a huge transcript" hang; a single
 *  catastrophic-backtracking pattern on one very long line is the residual that
 *  only a non-backtracking engine (RE2) fully defeats — see the README. */
const SEARCH_DEADLINE_MS = 2000;

export class Transcript {
  private store: TranscriptStore | null = null;
  private seq = 0;
  private byteSeq: Seq = 0;
  private cols: number;
  private rows: number;

  // Pending coalesce buffer (decoded output not yet flushed to a DATA block).
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private pendingStartByteSeq: Seq = 0;
  private bytesSinceCheckpoint = 0;

  private fault: { lastGoodSeq: number; error: string } | null = null;

  private constructor(
    private readonly policy: HistoryPolicy,
    cols: number,
    rows: number,
    private readonly now: () => number,
    /** Fired once, when the FIRST runtime write fault is recorded, so the disk
     *  failure logs at the moment it happens — not only if a reader later opens
     *  history. The leaf stays `@kolu/logger`-free: the ptyHost injects a closure
     *  that logs at `error` (F7). */
    private readonly onFault?: (err: unknown, lastGoodSeq: number) => void,
  ) {
    this.cols = cols;
    this.rows = rows;
  }

  /** Open (or resume) a transcript. `enabled: false` writes no DB; reads return
   *  `unavailable`. A reopen (cold restore / wake on the same id) continues the
   *  seq/byteSeq counters from the persisted max — appended history. */
  static open(args: {
    policy: HistoryPolicy;
    dbPath: string;
    cols: number;
    rows: number;
    now?: () => number;
    /** Logged-at-error sink for the first runtime write fault (F7). */
    onFault?: (err: unknown, lastGoodSeq: number) => void;
  }): Transcript {
    const t = new Transcript(
      args.policy,
      args.cols,
      args.rows,
      args.now ?? Date.now,
      args.onFault,
    );
    if (args.policy.enabled) {
      const store = TranscriptStore.open(args.dbPath);
      const resume: ResumeState = store.resumeState();
      t.store = store;
      t.seq = resume.maxSeq;
      t.byteSeq = resume.tipByteSeq;
    }
    return t;
  }

  /** A transcript whose store could NOT be opened (disk/path/schema fault at
   *  spawn). It keeps no store, drops every write, and serves reads as `faulted`
   *  / throws on the bulk reads — so the failure surfaces honestly instead of
   *  collapsing to the "history disabled" (`unavailable` / silent-empty) path the
   *  PTY-host fallback would otherwise read it as (F3). `enabled` stays whatever
   *  the policy carried, so `history()` reaches the fault check rather than
   *  short-circuiting to `unavailable`. */
  static failedOpen(
    policy: HistoryPolicy,
    cols: number,
    rows: number,
    err: unknown,
  ): Transcript {
    const t = new Transcript(policy, cols, rows, Date.now);
    t.fault = {
      lastGoodSeq: 0,
      error: err instanceof Error ? err.message : String(err),
    };
    return t;
  }

  // ---- WRITE path ---------------------------------------------------------

  /** Append decoded PTY output. Called from `proc.onData`'s post-parse callback,
   *  so the mirror reflects `data` and `mirror.atCleanBoundary()` is current. */
  appendData(data: string, mirror: MirrorView): void {
    if (!this.store || this.fault) return;
    this.cols = mirror.cols;
    this.rows = mirror.rows;
    // One UTF-8 transcode per chunk on this (hottest) path: the buffer IS the
    // byte count, so don't also `Buffer.byteLength` the same string.
    const buf = Buffer.from(data, "utf8");
    const bytes = buf.length;
    if (this.pending.length === 0) {
      this.pendingStartByteSeq = this.byteSeq;
    }
    this.pending.push(buf);
    this.pendingBytes += bytes;
    this.byteSeq += bytes;
    this.bytesSinceCheckpoint += bytes;
    try {
      // Checkpoint when we've buffered a cadence's worth of bytes AND either the
      // grid is at a clean line boundary (the common path — keeps cross-width
      // reflow byte-exact) OR we've blown past the hard ceiling with no clean
      // boundary in sight (the pathological no-newline span — force one to keep
      // the replay span bounded; see MAX_CHECKPOINT_GAP_BYTES) (F2).
      if (
        this.bytesSinceCheckpoint >= CHECKPOINT_BYTES &&
        (mirror.atCleanBoundary() ||
          this.bytesSinceCheckpoint >= MAX_CHECKPOINT_GAP_BYTES)
      ) {
        this.flushPending();
        this.captureCheckpoint(mirror);
        this.bytesSinceCheckpoint = 0;
        // Eviction floors are checkpoints, so it can only ever do work right
        // after one is captured — run it HERE, not on every `onData`, so the
        // retention scan stays off the per-chunk hot path (F3).
        this.maybeEvict();
      } else if (this.pendingBytes >= BLOCK_BYTES) {
        this.flushPending();
      }
    } catch (err) {
      this.handleFault(err);
    }
  }

  /** Journal a grid change at its true stream position — the load-bearing
   *  RESIZE record (the seam spike's negative control). */
  appendResize(cols: number, rows: number): void {
    if (!this.store || this.fault) {
      this.cols = cols;
      this.rows = rows;
      return;
    }
    try {
      // Flush the pending pre-resize output at the OLD width FIRST, so that DATA
      // block records the cols actually in effect when those bytes were written
      // — only THEN adopt the new grid. Setting `this.cols` before the flush
      // mislabels the just-ended span with the post-resize width, which collapses
      // faithful per-epoch export back onto the final width.
      this.flushPending();
      this.cols = cols;
      this.rows = rows;
      this.store.append({
        seq: ++this.seq,
        kind: RecordKind.RESIZE,
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
    // Retain the cause (not swallowed) alongside the last-good seq. Surfaced via
    // history()'s `faulted` page and the PTY keeps running — the one place
    // survivability outranks fail-fast (caught-error-must-not-collapse-to-empty:
    // we surface `faulted`, never present a truncated log as complete).
    this.fault = {
      lastGoodSeq: this.seq,
      error: err instanceof Error ? err.message : String(err),
    };
    // Log the actual I/O failure NOW (at error), so an operator sees the disk
    // fault even if no one ever opens history/copy/export to surface it (F7).
    this.onFault?.(err, this.fault.lastGoodSeq);
  }

  // ---- READ path ----------------------------------------------------------

  /** The current stream tip — the pager opens its first page at this cursor. */
  tipByteSeq(): Seq {
    return this.byteSeq;
  }

  /** One backward page ending at `beforeCursor` (or the tip when null),
   *  accumulating checkpoint-spans until ≥ `maxLines` rows or the floor. */
  async history(args: {
    beforeCursor: Seq | null;
    maxLines: number;
    width: number;
  }): Promise<HistoryResult> {
    if (!this.policy.enabled) return { kind: "unavailable" };
    if (this.fault)
      return { kind: "faulted", lastGoodSeq: this.fault.lastGoodSeq };
    if (!this.store) return { kind: "unavailable" };
    this.flushPending();
    const tip = this.byteSeq;
    let cursor = args.beforeCursor ?? tip;
    const oldest = this.store.oldestByteSeq();
    if (cursor <= oldest && oldest > 0) return { kind: "evicted" };
    const ansiParts: string[] = [];
    let rowCount = 0;
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
    return {
      kind: "ok",
      ansi: ansiParts.join(""),
      nextCursor: cursor,
      atFloor,
    };
  }

  /** Whole-transcript plain text, faithful per resize-epoch — the source both
   *  "Copy terminal text" and the pager's "Copy all history" read. */
  async readAllText(): Promise<string> {
    // A fault must surface, not silently fall back to the clipped live buffer:
    // throw so the caller's copy/PDF path toasts the failure (F3). A genuinely
    // disabled transcript (no fault, no store) returns "" → the honest opt-out
    // fallback.
    if (this.fault) throw new Error(`transcript faulted: ${this.fault.error}`);
    if (!this.store) return "";
    this.flushPending();
    const lines: string[] = [];
    for await (const seg of this.faithfulSegments(0, this.byteSeq)) {
      // Re-render each segment to plain rows via the same machinery.
      const rendered = await renderFaithful(seg.seed, seg.cols, seg.blocks);
      for (const r of rendered.rows) lines.push(r.text);
    }
    return lines.join("\n");
  }

  /** Stream faithful export segments oldest→newest (one per resize-epoch),
   *  each rendered at its historical width. */
  async *exportSegments(): AsyncIterable<ExportSegment> {
    // Surface a fault (F3): throw so the PDF export toasts the failure rather
    // than yielding nothing — which the client reads as "history disabled" and
    // silently falls back to the clipped live buffer.
    if (this.fault) throw new Error(`transcript faulted: ${this.fault.error}`);
    if (!this.store) return;
    this.flushPending();
    for await (const seg of this.faithfulSegments(0, this.byteSeq)) {
      const rendered = await renderFaithful(seg.seed, seg.cols, seg.blocks);
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
    // A fault surfaces (F3) rather than reading as "no matches" over a broken
    // transcript; a disabled/store-less transcript still returns empty.
    if (this.fault) throw new Error(`transcript faulted: ${this.fault.error}`);
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
    const deadline = this.now() + SEARCH_DEADLINE_MS;
    while (cursor > oldest) {
      const seed = this.store.latestCheckpointBefore(cursor);
      const from = seed ? seed.firstByteSeq : 0;
      const blocks = this.store.dataInRange(from, cursor);
      const seg = await renderReflow(seed, this.cols || 80, blocks);
      // Join wrapped continuation rows into logical lines (newest-first within
      // the span so global order stays newest-first).
      const logical = joinLogical(seg.rows);
      for (let i = logical.length - 1; i >= 0; i--) {
        if (test(logical[i]!)) hits.push({ cursor });
      }
      cursor = from;
      if (!seed) break;
      // Soft wall-clock cap at a SPAN boundary (like the hit cap below, never
      // mid-span): a slow/backtracking regex over a large history yields a
      // `truncated` page with `nextCursor = from` to resume from, rather than
      // blocking the daemon's event loop indefinitely (F5).
      if (this.now() >= deadline) {
        truncated = true;
        nextCursor = from;
        return { hits, nextCursor, truncated };
      }
      // Cap at a SPAN boundary, never mid-span: every hit in `[from, prevCursor)`
      // is now recorded, so resuming at `nextCursor = from` skips nothing (F8). A
      // mid-span cut + `nextCursor = from` would have re-opened the SAME span and
      // dropped its remaining older matches. The cap is therefore soft — it may
      // overshoot by one span's matches — which is the price of lossless resume.
      if (hits.length >= cap) {
        truncated = true;
        nextCursor = from;
        return { hits, nextCursor, truncated };
      }
    }
    return { hits, nextCursor, truncated };
  }

  // ---- internals ----------------------------------------------------------

  /** Split `[from, to)` into faithful render inputs, rendered at the cols
   *  actually in effect for each span. A RESIZE is a segment BOUNDARY, not an
   *  event inside a segment: each epoch is rendered (and serialized) FROZEN at its
   *  historical width before the next resize, so a 200-col table is never
   *  re-wrapped to a later narrow width (the export promise). The old shape pushed
   *  every DATA block first and every RESIZE after, then replayed them in one
   *  terminal — so resizes never landed at their recorded byte positions AND
   *  xterm's on-resize reflow re-wrapped every earlier span to the FINAL width.
   *  RESIZE byteSeqs sit exactly at DATA-block boundaries (`appendResize` flushes
   *  pending first), so partitioning DATA by `firstByteSeq < boundary` is exact.
   *
   *  A long resize-free epoch is ALSO split — at the same-width CHECKPOINT seams
   *  inside it — so the export never inflates one multi-hundred-MB epoch into a
   *  single in-memory segment (and the client never writes one giant offscreen
   *  buffer). Each sub-segment is seeded by the checkpoint at its start (a VT
   *  primer for content scrolled above the window, whose rows the renderer drops);
   *  checkpoints sit at clean line boundaries, so concatenating the sub-segments'
   *  ANSI reproduces the whole-epoch render — the same property the backward pager
   *  relies on. A checkpoint is used as a seam ONLY when its grid matches the
   *  current epoch width (it always does mid-epoch, since width is constant within
   *  an epoch); a width mismatch — only possible if a checkpoint byteSeq coincides
   *  with a resize — is skipped so a seed is never restored at the wrong width.
   *  The first epoch additionally carries the priming seed at `from`; later epochs
   *  start clean at the resize boundary. */
  private async *faithfulSegments(
    from: Seq,
    to: Seq,
  ): AsyncIterable<{
    seed: CheckpointRow | undefined;
    cols: number;
    rows: number;
    blocks: Uint8Array[];
  }> {
    if (!this.store || to <= from) return;
    const seed = this.store.latestCheckpointAtOrBefore(from === 0 ? 0 : from);
    const start = seed ? seed.firstByteSeq : 0;
    const dataRecs = this.store.dataRecordsInRange(start, to);
    const resizes = this.store.resizesInRange(start, to);
    // Checkpoints AFTER the priming seed are same-width seams to split each epoch.
    const ckpts = this.store.checkpointsInRange(start + 1, to);

    // Merge the two boundary streams (resize → width change + clean restart;
    // checkpoint → re-seed at the same width), oldest first. A checkpoint sorts
    // before a resize at the same byteSeq so it carries the pre-resize width.
    type Boundary =
      | { at: Seq; kind: "resize"; cols: number; rows: number }
      | { at: Seq; kind: "ckpt"; seed: CheckpointRow };
    const boundaries: Boundary[] = [
      ...resizes.map(
        (r): Boundary => ({
          at: r.firstByteSeq,
          kind: "resize",
          cols: r.cols,
          rows: r.rows,
        }),
      ),
      ...ckpts.map(
        (c): Boundary => ({ at: c.firstByteSeq, kind: "ckpt", seed: c }),
      ),
    ].sort((a, b) => a.at - b.at || (a.kind === "ckpt" ? -1 : 1));

    // The width in effect at the start of the current segment: the seed's cols, or
    // the FIRST data record's cols (the width when that block flushed — before any
    // later resize), not `this.cols` (the latest width).
    let segSeed = seed;
    let cols = seed?.cols ?? dataRecs[0]?.cols ?? this.cols;
    let rows = seed?.rows ?? dataRecs[0]?.rows ?? this.rows;
    let di = 0;
    const drain = (until: Seq): Uint8Array[] => {
      const blocks: Uint8Array[] = [];
      while (di < dataRecs.length && dataRecs[di]!.firstByteSeq < until) {
        blocks.push(dataRecs[di]!.payload);
        di++;
      }
      return blocks;
    };
    for (const b of boundaries) {
      const blocks = drain(b.at);
      if (blocks.length > 0 || segSeed)
        yield { seed: segSeed, cols, rows, blocks };
      if (b.kind === "resize") {
        // A later epoch begins clean at the resize boundary, on the new grid.
        segSeed = undefined;
        cols = b.cols;
        rows = b.rows;
      } else if (b.seed.cols === cols) {
        // Same-width seam mid-epoch: re-seed from the checkpoint, width unchanged.
        segSeed = b.seed;
      }
      // else: a width-mismatched checkpoint (coincident with a resize) — never
      // restore a seed at the wrong width; keep accumulating with the prior seed.
    }
    const tail = drain(to);
    if (tail.length > 0 || segSeed)
      yield { seed: segSeed, cols, rows, blocks: tail };
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

/** Compile a per-logical-line predicate — "does this line match". Default
 *  literal + case-insensitive (exactly what the find bar does today); regex/case
 *  are opt-in capabilities (reuse the source of truth — xterm's ISearchOptions
 *  shape), not knobs. The server only needs to record a hit's span cursor; the
 *  client's SearchAddon re-finds the offsets in-view. */
function compileMatcher(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): (line: string) => boolean {
  if (regex) {
    const re = new RegExp(query, caseSensitive ? "" : "i");
    return (line) => re.test(line);
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  return (line) => {
    if (needle.length === 0) return false;
    const hay = caseSensitive ? line : line.toLowerCase();
    return hay.includes(needle);
  };
}
