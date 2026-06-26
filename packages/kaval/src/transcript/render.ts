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

function write(
  term: InstanceType<typeof Terminal>,
  data: Uint8Array,
): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

/** A minimal view of `@xterm`'s `IBufferCell` — the accessors the fixed-row
 *  serializer reads. (`@xterm/headless` ships no types we can import here under
 *  the `require` interop, so the shape is restated; it is exercised by the
 *  width-lock + colour-fidelity tests.) */
interface BufferCell {
  getChars(): string;
  getWidth(): number;
  getFgColor(): number;
  getBgColor(): number;
  isFgRGB(): boolean;
  isBgRGB(): boolean;
  isFgPalette(): boolean;
  isBgPalette(): boolean;
  isBgDefault(): boolean;
  isBold(): boolean;
  isDim(): boolean;
  isItalic(): boolean;
  isUnderline(): boolean;
  isBlink(): boolean;
  isInverse(): boolean;
  isInvisible(): boolean;
  isStrikethrough(): boolean;
  isOverline(): boolean;
}

/** The SGR parameter list for a cell's FULL style, built from a clean reset
 *  (NOT a diff) — adapted 1:1 from `@xterm/addon-serialize`'s `_diffStyle` so the
 *  pager's colours match export's `serialize()` exactly. Each row starts from
 *  reset, so emitting the absolute style (rather than a cross-cell diff) keeps
 *  rows independent — the property that lets every row carry its own hard
 *  newline. Returns `[]` for the default style. */
function cellSgr(cell: BufferCell): number[] {
  const c: number[] = [];
  if (cell.isFgRGB()) {
    const v = cell.getFgColor();
    c.push(38, 2, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  } else if (cell.isFgPalette()) {
    const v = cell.getFgColor();
    if (v >= 16) c.push(38, 5, v);
    else c.push(v & 8 ? 90 + (v & 7) : 30 + (v & 7));
  }
  if (cell.isBgRGB()) {
    const v = cell.getBgColor();
    c.push(48, 2, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  } else if (cell.isBgPalette()) {
    const v = cell.getBgColor();
    if (v >= 16) c.push(48, 5, v);
    else c.push(v & 8 ? 100 + (v & 7) : 40 + (v & 7));
  }
  if (cell.isInverse()) c.push(7);
  if (cell.isBold()) c.push(1);
  if (cell.isUnderline()) c.push(4);
  if (cell.isOverline()) c.push(53);
  if (cell.isBlink()) c.push(5);
  if (cell.isInvisible()) c.push(8);
  if (cell.isItalic()) c.push(3);
  if (cell.isDim()) c.push(2);
  if (cell.isStrikethrough()) c.push(9);
  return c;
}

/** Serialize a row range as FIXED physical rows — each row's cells emitted with
 *  their SGR, then a hard `\r\n`. Unlike `serialize()` (which leaves wrapped rows
 *  un-terminated so they re-wrap at the consumer's width — the corruption when
 *  the consumer is a foreign width), this LOCKS each physical row to its content,
 *  so the output renders byte-identically at ANY display width: a TUI's
 *  `\r`/cursor redraws were already resolved into the final grid by the replay,
 *  and we ship that grid verbatim. Trailing cells are kept only while they carry
 *  content or a non-default background (a full-width status bar survives); the
 *  blank padding tail is dropped. Rows from `fromRow` to the last non-blank row. */
export function serializeFixedRows(
  term: InstanceType<typeof Terminal>,
  fromRow: number,
): string {
  const buf = term.buffer.active;
  const cell = buf.getNullCell() as unknown as BufferCell;
  const rowText = (y: number): string =>
    buf.getLine(y)?.translateToString(true) ?? "";
  let last = buf.length - 1;
  while (last >= fromRow && rowText(last) === "") last--;
  const out: string[] = [];
  for (let y = fromRow; y <= last; y++) {
    const line = buf.getLine(y);
    if (!line) {
      out.push("");
      continue;
    }
    // Last column worth emitting: the rightmost cell with content OR a
    // non-default background (so a colour-filled bar keeps its fill, but plain
    // trailing padding is trimmed).
    let lastCol = -1;
    for (let x = line.length - 1; x >= 0; x--) {
      line.getCell(x, cell as unknown as Parameters<typeof line.getCell>[1]);
      if (cell.getChars() !== "" || !cell.isBgDefault()) {
        lastCol = x;
        break;
      }
    }
    let row = "";
    let runKey = ""; // "" === the default (reset) style
    for (let x = 0; x <= lastCol; x++) {
      line.getCell(x, cell as unknown as Parameters<typeof line.getCell>[1]);
      if (cell.getWidth() === 0) continue; // wide-char trailing cell (no glyph)
      const codes = cellSgr(cell);
      const key = codes.join(";");
      if (key !== runKey) {
        // Reset then apply the absolute style, so each run is self-contained.
        row += `\x1b[0${codes.length ? `;${key}` : ""}m`;
        runKey = key;
      }
      const ch = cell.getChars();
      row += ch === "" ? " " : ch;
    }
    out.push(runKey === "" ? row : `${row}\x1b[0m`);
  }
  return out.map((r) => `${r}\r\n`).join("");
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
  while (
    rows.length &&
    rows[rows.length - 1]!.text === "" &&
    !rows[rows.length - 1]!.wrapped
  )
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

/** How many physical rows the restored seed occupies — i.e. the row index where
 *  the first DATA byte will land, which is exactly what {@link withThrowaway}
 *  drops so only DATA-replayed rows are returned.
 *
 *  After restoring `serialize({scrollback:0})` the cursor sits at the position the
 *  next byte continues from. Two boundary shapes both leave the seed's content
 *  rows COMPLETE — and the DATA starting on a FRESH row — so the whole cursor row
 *  is seed, not shared with DATA:
 *    - a clean line boundary: cursor at column 0 of an empty row (`cursorX === 0`),
 *      so `baseY + cursorY` already counts every seed row; and
 *    - a deferred-wrap boundary: the cursor parks at `cursorX === cols` on a FULL
 *      row (xterm defers the wrap), and the next byte wraps to the next row — so
 *      that full cursor row is also pure seed and must be counted (`+ 1`).
 *  Without the `+1`, a checkpoint forced at a deferred-wrap boundary (a >1 MiB
 *  no-newline span; see `MAX_CHECKPOINT_GAP_BYTES`) would leave its last full row
 *  in BOTH the older span's tail and this seeded span's head — duplicated/split
 *  across the seam. A genuine mid-row seed (`0 < cursorX < cols`, only at the
 *  adversarial HARD ceiling) is the one case DATA shares the cursor row, so it is
 *  NOT counted — there the split is inherent (see `HARD_CHECKPOINT_GAP_BYTES`). */
function seedBoundaryRow(term: InstanceType<typeof Terminal>): number {
  const b = term.buffer.active;
  return b.baseY + b.cursorY + (b.cursorX >= term.cols ? 1 : 0);
}

/** The shared throwaway-terminal lifecycle both render modes run inside: behind
 *  the semaphore, spin a `makeTerm(initialCols)`, run the mode-specific `body`
 *  (which seeds + replays and returns how many rows the seed occupies), then cut
 *  the common tail — DATA-replayed rows with the seed dropped, plus their ANSI —
 *  and dispose. Only the replay strategy varies between modes. */
function withThrowaway(
  initialCols: number,
  body: (t: Throwaway) => Promise<number>,
): Promise<RenderedSegment> {
  return renderSemaphore.run(async () => {
    const t = makeTerm(initialCols);
    try {
      const seedRows = await body(t);
      const rows = readRows(t.term).slice(seedRows);
      // Fixed-row, width-locked ANSI (a hard \r\n per physical row), so the page
      // renders byte-identically at any DISPLAY width — never reflowed to a foreign
      // width (the corruption this render path was changed to kill). `seedRows`
      // drops the restored seed exactly as before.
      const ansi = serializeFixedRows(t.term, seedRows);
      return { rows, ansi };
    } finally {
      t.term.dispose();
    }
  });
}

/** FAITHFUL render of one resize-epoch span — the SOLE renderer for both the
 *  copy-mode pager and export. Restore at the historical width (`seed.cols`, or
 *  `initialWidth` for the implicit byte-0 seed) and replay its DATA at THAT width
 *  — never reflowed to a reader/display width — so a TUI's `\r`/cursor redraws
 *  land on the rows they were emitted for (replaying at a foreign width is the
 *  corruption this design eliminates). Resizes are NOT replayed here: the
 *  orchestrator (`faithfulSegments`) partitions the stream at every RESIZE
 *  boundary and hands each span its own `seed.cols`, so a span is pure DATA at a
 *  single width. The returned ANSI is fixed-row (see {@link withThrowaway} →
 *  {@link serializeFixedRows}); the display chooses its own width and scrolls. */
export function renderFaithful(
  seed: CheckpointRow | undefined,
  initialWidth: number,
  dataBlocks: Uint8Array[],
): Promise<RenderedSegment> {
  return withThrowaway(seed ? seed.cols : initialWidth, async (t) => {
    let seedRows = 0;
    if (seed) {
      await write(t.term, zstdDecompressSync(seed.payload));
      seedRows = seedBoundaryRow(t.term);
    }
    await write(t.term, inflate(dataBlocks));
    return seedRows;
  });
}
