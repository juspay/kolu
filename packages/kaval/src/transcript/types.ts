/**
 * The on-disk transcript's typed record model — the kaval-domain framing that
 * sits on top of `node:sqlite` (the platform's embedded store). A terminal's
 * deep scrollback is NOT a flat byte dump: resizes are out-of-band (kaval calls
 * `headless.resize()`, never in the byte stream, yet they govern reflow), and a
 * range can't be rendered without a periodic VT seed. So the transcript stores
 * three typed record kinds — see {@link RecordKind} — keyed on a monotonic
 * decoded-byte position ({@link Seq}). Line numbers never go on the wire: they
 * shift under reflow, so a byte offset is the reflow-stable cursor and width is
 * a render-time parameter.
 *
 * This module is pure data + constants (no `node:sqlite`, no `@xterm`), so the
 * store, the renderer, and the orchestrator share one source of truth for the
 * schema and the tuning constants.
 */

/** A monotonic byte-sequence position into the per-PTY decoded DATA stream
 *  (the running sum of decoded-output byte lengths). Always minted and consumed
 *  at a ground-state clean line boundary; opaque on the wire. */
export type Seq = number;

/** The three record kinds the transcript frames over raw output.
 *  - `DATA`   — a zstd-compressed run of coalesced decoded PTY output.
 *  - `RESIZE` — the out-of-band grid change, at its true stream position; what
 *               makes a faithful replay reflow-correct (the negative control in
 *               the seam spike proved it load-bearing).
 *  - `CKPT`   — a periodic VT-state seed (`serialize({ scrollback: 0 })`),
 *               captured only at a clean line boundary, that lets a range render
 *               without replaying from byte 0. */
export const RecordKind = {
  DATA: 0,
  RESIZE: 1,
  CKPT: 2,
} as const;
export type RecordKind = (typeof RecordKind)[keyof typeof RecordKind];

/** One row of the `record` table, as the store reads/writes it. `payload` is a
 *  zstd BLOB for DATA (the coalesced output bytes) and CKPT (the serialized
 *  viewport); `null` for RESIZE (its grid is in `cols`/`rows`). */
export interface TranscriptRecord {
  seq: number;
  kind: RecordKind;
  firstByteSeq: Seq;
  tsMs: number;
  cols: number;
  rows: number;
  payload: Uint8Array | null;
}

/** Target size of a coalesced zstd DATA block. Output is buffered and flushed
 *  in ~64 KB runs rather than one row per `onData` chunk — the write-
 *  amplification trap. The spike measured ~0.02 ms to zstd-append a 64 KB block. */
export const BLOCK_BYTES = 64 * 1024;

/** Checkpoint cadence: capture one `CKPT` per ~64 KB of DATA, deferred to the
 *  next clean line boundary. Block-anchored (bytes, not a raw line count) so a
 *  pathological long line can't blow the replay budget and a render can
 *  decompress whole blocks. Reuses the DATA write-batch cadence rather than
 *  bolting on a second one. Replay cost was flat at 2.9–6.0 ms across K=50…1000. */
export const CHECKPOINT_BYTES = 64 * 1024;

/** Hard ceiling on the gap between checkpoints. A checkpoint is normally
 *  DEFERRED to the next clean line boundary (so cross-width reflow is byte-exact),
 *  but a pathological span with NO clean boundary — megabytes emitted with no
 *  newline and the cursor never at column 0 — would otherwise accumulate one
 *  unbounded replay span: `history()` reads every DATA block since the last
 *  checkpoint and `render.ts` `Buffer.concat`s them, recreating the memory spike
 *  this design exists to avoid (and defeating retention, which can only evict to a
 *  checkpoint). So past this many bytes-since-checkpoint we force a checkpoint at
 *  the current (non-clean) position. The forced seed is captured mid-line, so
 *  reflow to a DIFFERENT width may be imprecise across that one rare seam — a
 *  bounded fidelity cost paid only in the pathological case, strictly better than
 *  an unbounded span. Faithful export (same historical width) stays exact. */
export const MAX_CHECKPOINT_GAP_BYTES = 16 * CHECKPOINT_BYTES;

/** Default per-terminal retention cap (compressed payload bytes). Oldest
 *  records past this are DELETEd and an eviction watermark is raised; a
 *  sub-floor read returns `evicted`, never silent-empty. */
export const DEFAULT_RETENTION_BYTES = 256 * 1024 * 1024;

/** The transcript on-disk schema version — fails loud (distinct from
 *  `PTY_HOST_CONTRACT_VERSION`) if a DB written by an unknown schema is opened,
 *  rather than silently mis-reading it. */
export const TRANSCRIPT_FORMAT_VERSION = 1;

/** The minimal read-only view of the live mirror the WRITE path needs to place
 *  checkpoints at a clean boundary. Keeps the transcript decoupled from `@xterm`
 *  on the write side — the ptyHost builds this from the entry's headless mirror.
 *  (The READ path's renderer does import `@xterm` to spin throwaway terminals.) */
export interface MirrorView {
  /** Current grid columns. */
  readonly cols: number;
  /** Current grid rows. */
  readonly rows: number;
  /** True iff the mirror is at a ground-state clean line boundary: primary
   *  screen, cursor at column 0, viewport-top row not a wrapped continuation.
   *  `serialize({ scrollback: 0 })` preserves whole logical lines, so a
   *  checkpoint captured here re-wraps faithfully at any width. */
  atCleanBoundary(): boolean;
  /** Serialize the current viewport only (no scrollback) — the CKPT seed. */
  serializeViewport(): string;
}

/** Per-terminal history policy, carried on the spawn frame (B0-style): the
 *  daemon derives nothing, so a missing field is a loud crash, not a silent
 *  default. `enabled: false` writes no DB and reads return `unavailable`. */
export interface HistoryPolicy {
  enabled: boolean;
  retentionBytes: number;
}
