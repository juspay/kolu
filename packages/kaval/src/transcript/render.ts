/**
 * The checkpoint-replay range renderer — the read path's make-or-break half.
 *
 * Rendering any historical range without a checkpoint would replay from byte 0,
 * re-creating the multi-GB spike on every scroll. Instead each range render
 * restores the nearest checkpoint's `serialize({ scrollback: 0 })` seed into a
 * throwaway headless terminal, replays one bounded zstd-decompressed DATA run,
 * reads the rows, and disposes. Two modes (both proven byte-identical to a
 * single-shot render in the seam spike, 11/11):
 *   - REFLOW-to-current (the pager): restore@historical-cols → resize to the
 *     reader's width (xterm native reflow of the ≤rows seed) → replay DATA at
 *     that width. The returned rows are ALWAYS DATA-replayed (the seed is only a
 *     VT primer that scrolls above the window), which keeps the one upstream
 *     xterm wide+combining reflow artifact out of every returned line.
 *   - FAITHFUL (export/forensics): restore@historical-cols → replay DATA + the
 *     interleaved RESIZE records at their true positions, render at the
 *     historical per-span width. RESIZE is load-bearing (the spike's negative
 *     control), so a 200-col table is never re-wrapped to a narrow width.
 *
 * Renders run behind a small semaphore so a backfill burst can't re-storm the
 * read path with throwaway terminals.
 */

import { createRequire } from "node:module";
import { zstdDecompressSync } from "node:zlib";
import type { CheckpointRow } from "./store.ts";

// @xterm packages ship CJS only — createRequire for clean ESM interop, the same
// pattern the live mirror uses in ptyHost.ts.
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

/** One rendered physical row: its plain text and whether it is a wrapped
 *  continuation of the line above (so the orchestrator can snap to logical-line
 *  boundaries and join wrapped rows for width-independent search). */
export interface RenderedRow {
  text: string;
  wrapped: boolean;
}

/** A rendered range: the DATA-replayed rows (the seed dropped) plus the ANSI
 *  blob the pager writes into its own read-only xterm. */
export interface RenderedSegment {
  rows: RenderedRow[];
  /** Rendered ANSI of the DATA region only (seed excluded), top→bottom, for the
   *  pager xterm. Pages end at a clean line boundary, so writing pages
   *  oldest→newest reproduces the single-shot render. */
  ansi: string;
}

const DEFAULT_GRID_ROWS = 24;

interface Throwaway {
  term: InstanceType<typeof Terminal>;
  serialize: InstanceType<typeof SerializeAddon>;
}

function makeTerm(cols: number): Throwaway {
  const term = new Terminal({
    cols,
    rows: DEFAULT_GRID_ROWS,
    scrollback: 1_000_000,
    allowProposedApi: true,
    reflowCursorLine: true,
  });
  const serialize = new SerializeAddon();
  term.loadAddon(serialize);
  return { term, serialize };
}

function write(term: InstanceType<typeof Terminal>, data: Uint8Array): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

/** Read the buffer into rows, trimming the trailing all-blank, non-wrapped
 *  viewport tail (xterm pads the viewport to `rows`). */
function readRows(term: InstanceType<typeof Terminal>): RenderedRow[] {
  const buf = term.buffer.active;
  const rows: RenderedRow[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    rows.push({
      text: line?.translateToString(true) ?? "",
      wrapped: line?.isWrapped ?? false,
    });
  }
  while (rows.length && rows[rows.length - 1]!.text === "" && !rows[rows.length - 1]!.wrapped)
    rows.pop();
  return rows;
}

/** A counting semaphore — bounds concurrent throwaway-terminal renders. */
class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const renderSemaphore = new Semaphore(3);

/** Decompress + concatenate a run of zstd DATA blocks into one buffer (parsing
 *  is stream-equivalent to per-record writes; one write keeps replay cheap). */
function inflate(blocks: Uint8Array[]): Buffer {
  if (blocks.length === 0) return Buffer.alloc(0);
  return Buffer.concat(blocks.map((b) => zstdDecompressSync(b)));
}

/** Serialize only the DATA region — the physical rows BELOW the seed — so the
 *  seed never reaches the wire. `serialize` re-emits SGR from each cell's
 *  attributes (not from prior-line carry), so bounding scrollback to drop the
 *  top `seedRows` rows yields correct ANSI for the first kept row regardless of
 *  what scrolled above it. The bound is computed from the UNTRIMMED buffer
 *  length (serialize counts physical rows from the buffer bottom, trailing
 *  viewport blanks included); the trailing blanks are then stripped so pages
 *  concatenate without a spurious gap line. */
function serializeTail(t: Throwaway, seedRows: number): string {
  const bufLen = t.term.buffer.active.length;
  // serialize returns the bottom (scrollback + viewport) physical rows; bound it
  // to drop EXACTLY the top `seedRows` rows (the seed), keeping rows
  // [seedRows, bufLen).
  const scrollback = Math.max(0, bufLen - seedRows - DEFAULT_GRID_ROWS);
  const ansi = t.serialize.serialize({ scrollback });
  // Normalize the trailing edge to exactly one CRLF after the last content line:
  // strip the live viewport's blank tail AND any trailing cursor-positioning
  // escape, then re-terminate, so pages concatenate with neither a merged line
  // nor a spurious gap.
  return ansi.replace(/(?:\x1b\[[0-9;]*[Hf]|[ \t\r\n])+$/, "") + "\r\n";
}

/** The exact seed/DATA boundary row: after restoring `serialize({scrollback:0})`
 *  the cursor sits at column 0 of the first row DATA will write into, so its
 *  absolute index is precisely how many rows the seed occupies. (Measuring via
 *  trimmed `readRows` was off by the blank cursor row at some boundaries.) */
function seedBoundaryRow(term: InstanceType<typeof Terminal>): number {
  const b = term.buffer.active;
  return b.baseY + b.cursorY;
}

/** REFLOW-to-current render of `(seed, toBlocks]` at `width`. `seed` is the
 *  checkpoint seed (or `null` for the implicit byte-0 seed = a fresh terminal).
 *  Returns the DATA-replayed rows with the seed dropped, plus their ANSI. */
export function renderReflow(
  seed: CheckpointRow | undefined,
  width: number,
  dataBlocks: Uint8Array[],
): Promise<RenderedSegment> {
  return renderSemaphore.run(async () => {
    const t = makeTerm(seed ? seed.cols : width);
    try {
      let seedRows = 0;
      if (seed) {
        await write(t.term, zstdDecompressSync(seed.payload));
        t.term.resize(width, DEFAULT_GRID_ROWS);
        // Rows the restored+resized seed occupies BEFORE any DATA — dropped from
        // the return. Checkpoints sit at clean boundaries (cursor col 0, top not
        // wrapped), so the seed's last line is complete and the first DATA byte
        // starts a fresh line: seed and DATA rows never merge.
        seedRows = seedBoundaryRow(t.term);
      }
      await write(t.term, inflate(dataBlocks));
      const allRows = readRows(t.term);
      const rows = allRows.slice(seedRows);
      const ansi = serializeTail(t, seedRows);
      return { rows, ansi };
    } finally {
      t.term.dispose();
    }
  });
}

/** FAITHFUL render of `(seed, toByte]` for export/forensics: restore at the
 *  historical width and replay DATA + RESIZE at their true positions (no
 *  reflow-to-current), so each inter-RESIZE span renders at the cols actually in
 *  effect then. `events` is the byte-ordered run of DATA blocks and RESIZE
 *  records the orchestrator assembles. */
export function renderFaithful(
  seed: CheckpointRow | undefined,
  initialWidth: number,
  events: Array<
    | { kind: "data"; payload: Uint8Array }
    | { kind: "resize"; cols: number; rows: number }
  >,
): Promise<RenderedSegment> {
  return renderSemaphore.run(async () => {
    const t = makeTerm(seed ? seed.cols : initialWidth);
    try {
      let seedRows = 0;
      if (seed) {
        await write(t.term, zstdDecompressSync(seed.payload));
        seedRows = seedBoundaryRow(t.term);
      }
      let pending: Uint8Array[] = [];
      const flush = async () => {
        if (pending.length) {
          await write(t.term, inflate(pending));
          pending = [];
        }
      };
      for (const ev of events) {
        if (ev.kind === "data") pending.push(ev.payload);
        else {
          await flush();
          t.term.resize(ev.cols, ev.rows);
        }
      }
      await flush();
      const allRows = readRows(t.term);
      const rows = allRows.slice(seedRows);
      const ansi = serializeTail(t, seedRows);
      return { rows, ansi };
    } finally {
      t.term.dispose();
    }
  });
}
