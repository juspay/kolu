/**
 * `TranscriptStore` — the thin `node:sqlite` (WAL) layer under the transcript.
 *
 * This is the "reuse the platform's embedded store, don't hand-roll a storage
 * engine" half of the design (see `docs/atlas/src/content/atlas/electricity.html`
 * and `kaval-memory-architecture.html`). SQLite owns the B-tree index, WAL
 * durability + crash recovery, indexed range reads by byte / line / time, and
 * retention (`DELETE` + the freed pages reused). The kaval LEAF on top
 * (`transcript.ts` + `render.ts`) owns only the terminal-domain framing: the
 * `DATA`/`RESIZE`/`CKPT` schema, the byte-offset↔seed index, and rendering a
 * range by replaying from the nearest checkpoint.
 *
 * One synchronous `DatabaseSync` connection per PTY. `node:sqlite` is sync, so
 * appends and range reads serialize naturally on the single connection with no
 * cross-thread concurrency — WAL is for durability (a kaval OOM-abort loses at
 * most the last transaction), not reader/writer parallelism here.
 */

import { DatabaseSync } from "node:sqlite";
import {
  RecordKind as Kind,
  type RecordKind,
  type Seq,
  TRANSCRIPT_FORMAT_VERSION,
  type TranscriptRecord,
} from "./types.ts";

/** The append-time fields for one record (the store assigns nothing; the
 *  orchestrator owns the monotonic `seq`/`firstByteSeq` counters so they
 *  continue across a reopen — session restore appends with `seq` resuming
 *  from the persisted max). */
export interface AppendRecord {
  seq: number;
  kind: RecordKind;
  firstByteSeq: Seq;
  /** Decoded byte length this record advances the stream by (DATA only; 0 for
   *  RESIZE/CKPT, which sit AT a byte position without consuming bytes). Lets
   *  the tip and range bounds be computed without decompressing payloads. */
  byteLen: number;
  tsMs: number;
  cols: number;
  rows: number;
  payload: Uint8Array | null;
}

/** Where a reopened transcript resumes its counters from. */
export interface ResumeState {
  maxSeq: number;
  tipByteSeq: Seq;
}

/** A checkpoint row as the renderer consumes it. */
export interface CheckpointRow {
  firstByteSeq: Seq;
  cols: number;
  rows: number;
  /** The zstd-compressed `serialize({ scrollback: 0 })` seed. */
  payload: Uint8Array;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS record(
  seq          INTEGER PRIMARY KEY,
  kind         INTEGER NOT NULL,
  firstByteSeq INTEGER NOT NULL,
  byteLen      INTEGER NOT NULL,
  tsMs         INTEGER NOT NULL,
  cols         INTEGER NOT NULL,
  rows         INTEGER NOT NULL,
  payload      BLOB
);
CREATE INDEX IF NOT EXISTS ix_byte ON record(firstByteSeq);
CREATE INDEX IF NOT EXISTS ix_ts   ON record(tsMs);
`;

export class TranscriptStore {
  private readonly db: DatabaseSync;
  private readonly insertStmt;

  private constructor(db: DatabaseSync) {
    this.db = db;
    this.insertStmt = db.prepare(
      `INSERT INTO record(seq,kind,firstByteSeq,byteLen,tsMs,cols,rows,payload)
       VALUES(?,?,?,?,?,?,?,?)`,
    );
  }

  /** Open (or create) the per-PTY DB at `path`, in WAL mode, and validate the
   *  on-disk schema version — fail loud (not silent mis-read) on a mismatch,
   *  distinct from `PTY_HOST_CONTRACT_VERSION`. */
  static open(path: string): TranscriptStore {
    const db = new DatabaseSync(path);
    // WAL + the kolu-shared/sqlite house pragmas: one writer + durable-enough
    // (a crash loses at most the last txn), with the freed pages reused so a
    // retention DELETE doesn't bloat the file.
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("PRAGMA synchronous=NORMAL");
    db.exec(SCHEMA);
    const row = db
      .prepare("SELECT value FROM meta WHERE key='formatVersion'")
      .get() as { value: string } | undefined;
    if (row === undefined) {
      db.prepare("INSERT INTO meta(key,value) VALUES('formatVersion',?)").run(
        String(TRANSCRIPT_FORMAT_VERSION),
      );
    } else if (Number(row.value) !== TRANSCRIPT_FORMAT_VERSION) {
      db.close();
      throw new Error(
        `transcript: unknown on-disk format version ${row.value} (this build writes ${TRANSCRIPT_FORMAT_VERSION}) at ${path}`,
      );
    }
    return new TranscriptStore(db);
  }

  append(rec: AppendRecord): void {
    this.insertStmt.run(
      rec.seq,
      rec.kind,
      rec.firstByteSeq,
      rec.byteLen,
      rec.tsMs,
      rec.cols,
      rec.rows,
      rec.payload ?? null,
    );
  }

  /** Resume counters from the newest persisted record — `tipByteSeq` is the
   *  byte position one past the last DATA record, so a reopened transcript
   *  continues the stream seamlessly. */
  resumeState(): ResumeState {
    const row = this.db
      .prepare(
        "SELECT seq, firstByteSeq, byteLen FROM record ORDER BY seq DESC LIMIT 1",
      )
      .get() as
      | { seq: number; firstByteSeq: number; byteLen: number }
      | undefined;
    if (!row) return { maxSeq: 0, tipByteSeq: 0 };
    return {
      maxSeq: row.seq,
      tipByteSeq: row.firstByteSeq + row.byteLen,
    };
  }

  /** DATA payloads whose content lies in `[fromByteSeq, toByteSeq)`, oldest
   *  first — `fromByteSeq` and `toByteSeq` are record boundaries (a checkpoint
   *  byteSeq or the flushed tip), so each returned record is wholly inside the
   *  range. Returns the zstd BLOBs for the renderer to decompress + concatenate. */
  dataInRange(fromByteSeq: Seq, toByteSeq: Seq): Uint8Array[] {
    const rows = this.db
      .prepare(
        `SELECT payload FROM record
         WHERE kind=? AND firstByteSeq>=? AND firstByteSeq<? AND payload IS NOT NULL
         ORDER BY firstByteSeq`,
      )
      .all(Kind.DATA, fromByteSeq, toByteSeq) as { payload: Uint8Array }[];
    return rows.map((r) => r.payload);
  }

  /** DATA records (positioned) whose content lies in `[fromByteSeq, toByteSeq)`,
   *  oldest first — like {@link dataInRange} but carrying each block's
   *  `firstByteSeq` and historical grid (`cols`/`rows`) so FAITHFUL export can
   *  partition the blocks into resize-epochs and render each at the width then in
   *  effect (the reflow-to-current pager needs only the payloads). */
  dataRecordsInRange(
    fromByteSeq: Seq,
    toByteSeq: Seq,
  ): { firstByteSeq: Seq; cols: number; rows: number; payload: Uint8Array }[] {
    return this.db
      .prepare(
        `SELECT firstByteSeq, cols, rows, payload FROM record
         WHERE kind=? AND firstByteSeq>=? AND firstByteSeq<? AND payload IS NOT NULL
         ORDER BY firstByteSeq`,
      )
      .all(Kind.DATA, fromByteSeq, toByteSeq) as {
      firstByteSeq: Seq;
      cols: number;
      rows: number;
      payload: Uint8Array;
    }[];
  }

  /** RESIZE records in `(fromByteSeq, toByteSeq]`, oldest first — FAITHFUL mode
   *  (export/forensics) replays these at their true stream position; the
   *  reflow-to-current pager path ignores them. */
  resizesInRange(
    fromByteSeq: Seq,
    toByteSeq: Seq,
  ): { firstByteSeq: Seq; cols: number; rows: number }[] {
    return this.db
      .prepare(
        `SELECT firstByteSeq, cols, rows FROM record
         WHERE kind=? AND firstByteSeq>? AND firstByteSeq<=?
         ORDER BY firstByteSeq`,
      )
      .all(Kind.RESIZE, fromByteSeq, toByteSeq) as {
      firstByteSeq: Seq;
      cols: number;
      rows: number;
    }[];
  }

  /** CHECKPOINT rows whose seed sits in `[fromByteSeq, toByteSeq)`, oldest first
   *  — FAITHFUL export splits a long resize-free epoch at these same-width seams
   *  so one giant epoch is never inflated into a single in-memory segment. Each
   *  carries its historical grid so the caller can guard against re-seeding
   *  across a width change. */
  checkpointsInRange(fromByteSeq: Seq, toByteSeq: Seq): CheckpointRow[] {
    return this.db
      .prepare(
        `SELECT firstByteSeq, cols, rows, payload FROM record
         WHERE kind=? AND firstByteSeq>=? AND firstByteSeq<? AND payload IS NOT NULL
         ORDER BY firstByteSeq`,
      )
      .all(Kind.CKPT, fromByteSeq, toByteSeq) as {
      firstByteSeq: Seq;
      cols: number;
      rows: number;
      payload: Uint8Array;
    }[];
  }

  /** The newest checkpoint STRICTLY before `byteSeq` (so a backward page always
   *  makes progress to an earlier seed), or `undefined` when none — the caller
   *  then falls back to the implicit byte-0 seed (a fresh terminal). */
  latestCheckpointBefore(byteSeq: Seq): CheckpointRow | undefined {
    const row = this.db
      .prepare(
        `SELECT firstByteSeq, cols, rows, payload FROM record
         WHERE kind=? AND firstByteSeq<? ORDER BY firstByteSeq DESC LIMIT 1`,
      )
      .get(Kind.CKPT, byteSeq) as CheckpointRow | undefined;
    return row?.payload ? row : undefined;
  }

  /** The newest checkpoint at or before `byteSeq` — the snapshot-frame's
   *  `historyCursor` (the hot↔cold join), and the oldest seed search can use. */
  latestCheckpointAtOrBefore(byteSeq: Seq): CheckpointRow | undefined {
    const row = this.db
      .prepare(
        `SELECT firstByteSeq, cols, rows, payload FROM record
         WHERE kind=? AND firstByteSeq<=? ORDER BY firstByteSeq DESC LIMIT 1`,
      )
      .get(Kind.CKPT, byteSeq) as CheckpointRow | undefined;
    return row?.payload ? row : undefined;
  }

  /** The oldest retained byteSeq (the eviction floor). A read whose cursor
   *  falls below this is `evicted`, never silent-empty. */
  oldestByteSeq(): Seq {
    const row = this.db
      .prepare("SELECT MIN(firstByteSeq) AS m FROM record")
      .get() as { m: number | null };
    return row.m ?? 0;
  }

  /** Total stored payload bytes — the retention cap's independent variable. */
  totalPayloadBytes(): number {
    const row = this.db
      .prepare("SELECT COALESCE(SUM(LENGTH(payload)),0) AS b FROM record")
      .get() as { b: number };
    return row.b;
  }

  /** Find the oldest checkpoint such that the payload bytes from it forward fit
   *  under `retentionBytes`. Evicting to a CHECKPOINT keeps the new floor
   *  self-seeding (the oldest retained data still has a seed at or before it).
   *  Returns the checkpoint byteSeq to evict before, or `undefined` if no
   *  eviction is needed / possible. */
  evictionCheckpoint(retentionBytes: number): Seq | undefined {
    const total = this.totalPayloadBytes();
    if (total <= retentionBytes) return undefined;
    // Walk checkpoints oldest→newest; the first whose "bytes from here forward"
    // fits the cap is the new floor. Keep at least the newest checkpoint.
    const ckpts = this.db
      .prepare(
        `SELECT firstByteSeq FROM record WHERE kind=? ORDER BY firstByteSeq ASC`,
      )
      .all(Kind.CKPT) as { firstByteSeq: Seq }[];
    for (const c of ckpts) {
      const after = this.db
        .prepare(
          "SELECT COALESCE(SUM(LENGTH(payload)),0) AS b FROM record WHERE firstByteSeq>=?",
        )
        .get(c.firstByteSeq) as { b: number };
      if (after.b <= retentionBytes) return c.firstByteSeq;
    }
    return undefined;
  }

  /** DELETE every record strictly before `byteSeq` — retention's reclaim. The
   *  freed pages are reused by later inserts (auto-vacuum off; WAL checkpoints
   *  keep the file bounded). */
  evictBefore(byteSeq: Seq): void {
    this.db.prepare("DELETE FROM record WHERE firstByteSeq<?").run(byteSeq);
  }

  /** Project a stored row to the public {@link TranscriptRecord} shape (tests). */
  allRecords(): TranscriptRecord[] {
    return this.db
      .prepare(
        "SELECT seq,kind,firstByteSeq,tsMs,cols,rows,payload FROM record ORDER BY seq",
      )
      .all() as unknown as TranscriptRecord[];
  }

  close(): void {
    this.db.close();
  }
}
