/** Prepend older scrollback into a LIVE xterm buffer, in place.
 *
 *  The scrollback-backfill leaf. Attach paints only the recent screenful
 *  (kaval's bounded snapshot); as the user scrolls up, `Terminal.tsx` fetches
 *  older raw chunks from kaval (`screen.history`) and hands them here. Each
 *  chunk is replayed through a SCRATCH terminal at the live width — the real
 *  parser, so wraps / SGR / wide cells are exact — then its `BufferLine` objects
 *  (plain data) are spliced into the TOP of the live buffer's `CircularList` and
 *  every scroll register is shifted by the inserted count, so the content the
 *  user is looking at does not move: only the scrollbar thumb shrinks. The
 *  technique and its reflow fidelity are proven by `xtermPrepend.spike.test.ts`.
 *
 *  ── FAIL LOUD — this leaf deliberately INVERTS its sibling `xtermInternals.ts`.
 *  That module degrades to a no-op when a private `_core.*` symbol is missing,
 *  which is right for a cosmetic read (a byte count, a mouse-coord patch). It is
 *  WRONG here: a silent partial prepend corrupts a terminal. The spike
 *  demonstrated the one true corruption mode live — splicing past `maxLength`
 *  silently trims the oldest rows while the register arithmetic still assumes
 *  they exist, so the buffer and its scroll offsets desync. So every missing
 *  symbol and every headroom shortfall THROWS. The caller sizes the client's
 *  scrollback (`DEFAULT_SCROLLBACK`) so the whole mirror always fits and asserts
 *  that at startup; a throw here means that invariant broke or xterm's shape did,
 *  and the contract-pin tests turn a shape change into red CI, never
 *  user-visible corruption. */

import { ORPCError } from "@orpc/client";
import { Terminal as XTerm } from "@xterm/xterm";

/* ------------------------------------------------------------------ */
/* The pinned internal shape — the whole reach into xterm privates.   */
/* Mirrors the corpus in `xtermPrepend.spike.test.ts`; the contract-   */
/* pin tests assert every symbol below exists with this shape in both  */
/* `@xterm/xterm` and `@xterm/headless`.                               */
/* ------------------------------------------------------------------ */

interface BufferLineInternal {
  isWrapped: boolean;
  translateToString(trimRight?: boolean, start?: number, end?: number): string;
}

interface CircularListInternal {
  length: number;
  maxLength: number;
  get(i: number): BufferLineInternal | undefined;
  splice(
    start: number,
    deleteCount: number,
    ...items: BufferLineInternal[]
  ): void;
}

interface BufferInternal {
  lines: CircularListInternal;
  ydisp: number;
  ybase: number;
  y: number;
  x: number;
  savedY: number;
}

interface CoreInternal {
  buffer: BufferInternal; // the ACTIVE buffer (scratch reads this)
  buffers: { normal: BufferInternal };
  _bufferService: { _onScroll: { fire(ydisp: number): void } };
}

/** Any terminal we can write into and steal lines from — the live `@xterm/xterm`
 *  and the scratch (`@xterm/xterm` or `@xterm/headless`) share this surface. */
export interface ScratchTerminal {
  readonly cols: number;
  readonly rows: number;
  write(data: string, callback?: () => void): void;
  dispose(): void;
}

/** Reach the pinned internals, or THROW — never degrade. The whole technique is
 *  unsafe with a partial shape, so a missing `_core` is a hard failure the
 *  caller must not swallow (see the file header). */
function coreOf(term: { cols: number }): CoreInternal {
  const core = (term as unknown as { _core?: CoreInternal })._core;
  if (!core?.buffers?.normal?.lines || !core._bufferService?._onScroll?.fire) {
    throw new Error(
      "xterm internals contract broken: scrollback-backfill cannot reach _core.buffers.normal.lines / _bufferService._onScroll.fire",
    );
  }
  return core;
}

/** The scratch's rows for this chunk, stolen. The content occupies rows
 *  0..(ybase + y - 1); the cursor row (ybase + y) carries content too WHEN the
 *  replayed write ended mid-line, which `SerializeAddon.serialize({range})` (the
 *  production chunk source) produces for a non-blank last row: its output has no
 *  trailing newline, so the cursor lands on it (`x > 0`, including the
 *  deferred-wrap `x === cols` case). Missing that row silently drops the seam
 *  line — the row at absolute index `before - 1`, which the snapshot does not
 *  already hold — from every backfill boundary.
 *
 *  `servedRows` is the mirror-range row count the server actually consumed for
 *  this chunk (`before - topLine`). A range that ENDS in blank rows replays to
 *  FEWER rows than it spans: `serialize({range})` has no trailing newline, so
 *  the scratch cursor comes to rest on the range's last blank row with `x === 0`
 *  — which the content count does NOT include — while the server still advanced
 *  its cursor across the full span. Dropping those trailing blank rows (at least
 *  the final one, more if a blank tail collapses) compresses the backfilled
 *  buffer's vertical spacing below native history (F10). So steal
 *  `max(content, servedRows)` rows: the caller sizes the scratch to hold at
 *  least `servedRows` rows (`replayToLines`), so the rows beyond the content are
 *  the scratch's OWN distinct initialized blank `BufferLine`s — the trailing
 *  blanks, materialized exactly, with no aliasing or newline padding. At stable
 *  width `content <= servedRows` always (serializing N rows at width W and
 *  replaying at W yields at most N rows), so `max` = `servedRows`; the `content`
 *  leg only wins in the transient differing-width case (a foreign reflow, F3)
 *  where stealing the full content avoids dropping real text. */
function stealContentLines(
  scratch: ScratchTerminal,
  servedRows: number,
): BufferLineInternal[] {
  const buf = coreOf(scratch).buffer;
  const content = buf.ybase + buf.y + (buf.x > 0 ? 1 : 0);
  const n = Math.max(content, servedRows);
  const out: BufferLineInternal[] = [];
  for (let i = 0; i < n; i++) {
    const line = buf.lines.get(i);
    // A hole here would mean the scratch buffer disagrees with its own cursor /
    // sizing — a broken invariant, not a recoverable gap. Fail loud.
    if (!line)
      throw new Error(`scrollback-backfill: scratch line ${i} missing`);
    out.push(line);
  }
  return out;
}

/** Default scratch: an UNOPENED `@xterm/xterm` at the given size. Unopened means
 *  no renderer and no DOM — it just parses bytes into a buffer, which is all the
 *  steal needs. `scrollback` is generous so a large chunk never self-trims in
 *  the scratch before we steal it. If a browser is found to reject an unopened
 *  `write()`, swap this one factory for an `@xterm/headless` instance (its
 *  `BufferLine` shape is verified identical by the contract-pin tests). */
function defaultScratch(cols: number, rows: number): ScratchTerminal {
  return new XTerm({
    cols,
    rows,
    scrollback: 100_000,
    allowProposedApi: true,
  }) as unknown as ScratchTerminal;
}

/** Replay `rawChunk` through a scratch terminal (real parser) and return its
 *  rows, stolen. Async because xterm's `write` is async — the buffer only
 *  reflects the bytes once the write callback fires.
 *
 *  The scratch viewport is sized to `max(rows, servedRows)` so that when the
 *  chunk's content is shorter than the mirror range it spans (trailing blanks
 *  trimmed by `serialize`), the trailing rows the steal reconstructs are the
 *  scratch's own distinct initialized blank `BufferLine`s (see
 *  `stealContentLines`). Width stays the LIVE `cols` so wraps replay exactly. */
async function replayToLines(
  rawChunk: string,
  cols: number,
  rows: number,
  servedRows: number,
  makeScratch: (cols: number, rows: number) => ScratchTerminal,
): Promise<BufferLineInternal[]> {
  const scratch = makeScratch(cols, Math.max(rows, servedRows));
  try {
    await new Promise<void>((resolve) => scratch.write(rawChunk, resolve));
    return stealContentLines(scratch, servedRows);
  } finally {
    scratch.dispose();
  }
}

/** True when the terminal is showing its ALTERNATE buffer (a full-screen TUI).
 *  There is no scrollback to extend there, so backfill is skipped — a deliberate
 *  no-op, not a failure. Public API, no internals reach. */
export function isAltBufferActive(term: {
  buffer: { active: { type: string } };
}): boolean {
  return term.buffer.active.type === "alternate";
}

/** Prepend `rawChunk` (older raw PTY bytes, from kaval's `getHistory`) above the
 *  existing content of the live terminal. `servedRows` is the mirror-range row
 *  count the server consumed for this chunk (`before - topLine`); the prepend
 *  materializes that many rows so a range whose trailing blanks `serialize`
 *  trimmed still occupies its full height (see `stealContentLines`). Returns the
 *  number of rows inserted (M) — the caller advances its own bookkeeping by
 *  this. Returns 0 without touching the buffer when the range is truly empty
 *  (`servedRows === 0`) or the alt buffer is active. An empty chunk that still
 *  spans rows (`servedRows > 0`, an all-blank range) materializes those blank
 *  rows rather than returning 0.
 *
 *  THROWS (never silently degrades) when xterm's internal shape is missing or
 *  the prepend would overflow the live buffer's `maxLength` — see the file
 *  header. Clears the selection first: xterm's `SelectionService` listens only
 *  to `onTrim`, not `onInsert`, so an active selection would otherwise point at
 *  the wrong rows after the shift (MVP: cleared, not preserved).
 *
 *  `shouldCommit` is re-checked AFTER the scratch replay (an async task boundary)
 *  and BEFORE the buffer splice: replaying the chunk suspends on xterm's write
 *  callback, during which a `reset()` (fresh-snapshot re-attach) or a width
 *  `resize` (reflow) can land — splicing old-width lines into a reflowed buffer,
 *  or scrollback onto a just-reset one, is corruption. Returning `false` makes
 *  the prepend a clean no-op (returns 0), the same discard the caller's epoch
 *  guard performs for a stale fetch. */
export async function prependScrollback(
  term: XTerm,
  rawChunk: string,
  servedRows: number,
  opts?: {
    makeScratch?: (cols: number, rows: number) => ScratchTerminal;
    shouldCommit?: () => boolean;
  },
): Promise<number> {
  // An empty serialized chunk is only a true no-op when the range it stands for
  // is ALSO empty (`servedRows === 0` — the exhausted / gone-PTY reply). An
  // ENTIRELY-BLANK range serializes to "" too (no content, no trailing newline)
  // yet spans `servedRows > 0` mirror rows; those blank rows are real terminal
  // content, so fall through and materialize them from the sized scratch's own
  // initialized blank `BufferLine`s (see `stealContentLines`) — dropping them
  // would compress the backfilled buffer's spacing below native history (F10).
  if (rawChunk.length === 0 && servedRows === 0) return 0;
  // No scrollback to extend under a full-screen app; caller shouldn't ask, but
  // guard anyway (a deliberate skip, not a corruption).
  if (
    isAltBufferActive(
      term as unknown as { buffer: { active: { type: string } } },
    )
  )
    return 0;

  const lines = await replayToLines(
    rawChunk,
    term.cols,
    term.rows,
    servedRows,
    opts?.makeScratch ?? defaultScratch,
  );
  const m = lines.length;
  if (m === 0) return 0;
  // The terminal may have been reset or resized while the scratch replay was
  // suspended on its write callback — abandon the splice if so (see the doc).
  if (opts?.shouldCommit && !opts.shouldCommit()) return 0;

  const core = coreOf(term);
  const buf = core.buffers.normal;

  // Fail fast on no headroom: splicing past `maxLength` makes `CircularList`
  // silently trim the oldest rows while the register shift below still counts
  // them — the demonstrated corruption. The caller's baked sizing invariant
  // (client scrollback ≥ mirror + snapshot) makes this unreachable in practice;
  // the throw is the tripwire if it ever isn't.
  if (buf.lines.length + m > buf.lines.maxLength) {
    throw new Error(
      `scrollback-backfill: prepend would overflow (${buf.lines.length} + ${m} > ${buf.lines.maxLength}); client scrollback is undersized for the mirror`,
    );
  }

  // Clear the selection before mutating rows it indexes (see the doc above).
  term.clearSelection();

  // Insert above everything. `splice(0, 0, ...)` fires `onInsert`, so markers and
  // decorations shift themselves.
  buf.lines.splice(0, 0, ...lines);

  // Keep every absolute-row register pointing at the same content, so the
  // viewport does not move — only the scrollbar thumb shrinks.
  buf.ybase += m;
  buf.ydisp += m;
  buf.savedY += m;

  // Tell the renderer the display offset changed: `_onScroll.fire` cascades the
  // selection refresh + viewport sync, and a `refresh` of the visible rows
  // rebuilds the atlas from identical content (flicker-free). The diff is 0, a
  // no-op scroll, so there is no feedback loop.
  core._bufferService._onScroll.fire(buf.ydisp);
  term.refresh(0, term.rows - 1);

  return m;
}

/** Rows requested per backfill fetch. Bounds a chunk's serialized payload and
 *  the scratch-replay cost; prepending M rows moves the viewport M rows off the
 *  top, so the user scrolls again to trigger the next fetch. */
export const HISTORY_CHUNK_ROWS = 500;

/** One older-history chunk from the server, as the controller consumes it. */
export interface HistoryChunk {
  chunk: string;
  topLine: number;
  exhausted: boolean;
  /** True when the reflow epoch the controller stamped on the fetch no longer
   *  matches the mirror's current generation — a width reflow (this OR a foreign
   *  attach's resize) renumbered absolute rows since the cursor was seeded, so
   *  the chunk is empty and the controller HALTS backfill until a fresh snapshot
   *  re-seeds (F3). Absent/false from a host that predates the epoch field
   *  (fail-open — the historical single-width behavior). */
  stale?: boolean;
}

/** Drives scrollback backfill for one terminal: when the user scrolls near the
 *  top of what's loaded, fetch the next older chunk and prepend it, until the
 *  mirror is exhausted. Owns the backfill cursor (an ABSOLUTE mirror-line index,
 *  seeded from the attach snapshot's `topLine`) and the races around it:
 *
 *   - An in-flight guard serializes fetches (one chunk at a time).
 *   - An EPOCH counter, bumped on every `seed`/`reset` and every width change,
 *     is captured at fetch start; a fetch that returns into a different epoch is
 *     DISCARDED, never spliced — this is the resize guard (a chunk serialized at
 *     the old width must not land in a reflowed buffer) and the re-attach guard
 *     (a chunk must not paint onto a terminal that was `reset()`) in one check.
 *   - A LOCAL width change PAUSES backfill (`cursor = null`): an absolute cursor
 *     names a row index that reflow shifts, so rather than fetch against a stale
 *     anchor, the controller waits for the next snapshot frame to re-`seed` it.
 *     (Continuous backfill across a resize would need a reflow-invariant cursor —
 *     a deliberate follow-up; the common stable-width path is fully covered.)
 *
 *   - A FOREIGN width change — another client attached to the SAME PTY (a
 *     `kaval-tui attach`, which resizes the shared mirror last-resize-wins) —
 *     reflows the mirror underneath us WITHOUT our `term.cols` changing, so the
 *     local `onResize` pause above never fires and our absolute cursor goes stale
 *     against a renumbered buffer. Left unguarded, the next `getHistory` would
 *     splice a duplicated or skipped band that PERSISTS (our own later resize only
 *     `pause()`s, never re-seeds, so a fresh anchor arrives only with the next
 *     snapshot). Unlike the transient LIVE-view wrap garble at differing widths
 *     (which self-heals on the next repaint), that spliced history stays wrong.
 *     So the cursor carries a REFLOW EPOCH: the attach snapshot stamps the
 *     mirror's reflow generation, `seed` captures it, and every fetch echoes it;
 *     the host serves an empty `stale` reply once the generation has moved, and
 *     the controller HALTS (same `pause()`) instead of splicing. Halt-not-corrupt
 *     by construction: worst case backfill stops early until the next snapshot
 *     re-seeds, never a corrupted splice. A reflow-invariant (logical-line) cursor
 *     that keeps backfilling ACROSS a foreign resize — plus the size-negotiation
 *     `attach.ts` earmarks ("a size-change tap would be contract 2.2") — remains
 *     the note-5 follow-up; this epoch gate is the fail-safe until then. A host
 *     predating the epoch field omits `stale`, so the gate is fail-open (no epoch
 *     → the historical single-width behavior). */
export interface BackfillController {
  /** Seed/re-seed the cursor from an attach (or re-attach) snapshot's topLine,
   *  plus the mirror's reflow generation at snapshot time (`reflowEpoch`, echoed
   *  on every fetch so a foreign-resize reflow halts backfill — F3). Undefined
   *  from a host predating the field (fail-open). */
  seed(topLine: number, reflowEpoch?: number): void;
  /** Forget the cursor (paused) — call when xterm is reset for a fresh snapshot,
   *  before the new snapshot's `seed`. */
  reset(): void;
  dispose(): void;
}

export function createBackfillController(
  term: XTerm,
  opts: {
    /** Fetch the chunk of up to `max` rows above absolute line `before`,
     *  stamping the reflow generation the cursor was seeded under (`epoch`) so
     *  the host can return an empty `stale` reply after a reflow (F3). `epoch` is
     *  undefined when the snapshot carried none (older host — fail-open). */
    fetch: (
      before: number,
      max: number,
      epoch: number | undefined,
    ) => Promise<HistoryChunk>;
    /** Surface a fetch failure that is NOT an expected teardown (a killed PTY's
     *  typed `NOT_FOUND`). Called for transport / auth / schema / server faults
     *  so backfill can't silently leave a hole — the caller toasts it; a later
     *  scroll retries. REQUIRED: the controller exposes no other error accessor,
     *  so an omitted handler would silently recreate the swallow this exists to
     *  prevent (fail-loud). A caller that genuinely wants to ignore faults passes
     *  an explicit no-op `() => {}` — a visible decision, not a missing one. */
    onError: (err: unknown) => void;
    /** Test seam: inject a small trigger so a controller test fires the near-top
     *  fetch without a giant buffer (defaults to 2× the visible rows). */
    triggerRows?: number;
    /** Test seam: substitute the prepend so a controller test can assert the
     *  epoch/dispose races without a real xterm splice. Receives `shouldCommit`,
     *  the guard the production prepend re-checks after its async replay, and
     *  `servedRows` (the mirror-range span for the chunk). */
    prepend?: (
      term: XTerm,
      chunk: string,
      shouldCommit: () => boolean,
      servedRows: number,
    ) => Promise<number>;
  },
): BackfillController {
  const prepend =
    opts.prepend ??
    ((t, c, shouldCommit, servedRows) =>
      prependScrollback(t, c, servedRows, { shouldCommit }));
  let cursor: number | null = null;
  // The mirror's reflow generation the current cursor was seeded under, echoed
  // on each fetch so the host halts us after a foreign-resize reflow (F3).
  // Undefined when the snapshot carried none (older host) — fail-open.
  let seedEpoch: number | undefined;
  let exhausted = false;
  let inFlight = false;
  let epoch = 0;
  let disposed = false;
  let lastCols = term.cols;

  // Pause backfill and invalidate any in-flight fetch: forget the cursor and
  // bump the epoch so a chunk fetched for the old generation is discarded, not
  // spliced. Shared by an explicit `reset()` and a width-change resize — a
  // resize is a pause too — so the invalidation step has one home.
  function pause(): void {
    cursor = null;
    exhausted = false;
    epoch++;
  }

  async function maybeBackfill(): Promise<void> {
    if (cursor === null || exhausted || inFlight || disposed) return;
    if (
      isAltBufferActive(
        term as unknown as { buffer: { active: { type: string } } },
      )
    )
      return;
    const triggerRows = opts.triggerRows ?? term.rows * 2;
    // `viewportY` is the top visible row (ydisp); near 0 means scrolled to the
    // top of what's loaded.
    if (term.buffer.active.viewportY > triggerRows) return;

    inFlight = true;
    let before = cursor;
    const myEpoch = epoch;
    const fetchCols = term.cols;
    // The fetch, the prepend's inner replay, AND the window between them are all
    // async task boundaries a reset/resize/dispose can land in. `stillValid`
    // captures the one invariant — same epoch, same width, not disposed — that
    // every commit downstream is gated on; `dispose()` and the resize handler
    // bump `epoch`/set `disposed`, so a chunk fetched for the old shape is
    // discarded rather than spliced onto a torn-down / reflowed / reset buffer.
    const stillValid = () =>
      !disposed && epoch === myEpoch && term.cols === fetchCols;
    try {
      // Loop rather than fetch once: a page that serializes to nothing (an
      // all-blank run of scrollback) inserts zero rows, so the viewport does NOT
      // move and no `onScroll` would ever re-arm the fetch — backfill would
      // STALL with older content still above. So keep paging here until a page
      // actually inserts rows (viewport moved — let the user scroll again) or the
      // mirror is exhausted.
      for (;;) {
        if (
          isAltBufferActive(
            term as unknown as { buffer: { active: { type: string } } },
          )
        )
          return;
        let res: HistoryChunk;
        try {
          res = await opts.fetch(before, HISTORY_CHUNK_ROWS, seedEpoch);
        } catch (err) {
          // A killed terminal / exited PTY makes the padi handler reject with a
          // typed NOT_FOUND — expected teardown, swallowed; a later scroll
          // retries. Every OTHER fault (transport, auth, schema, server) is
          // surfaced via `onError` rather than vanishing, so backfill can't
          // silently leave a hole. This catch is scoped to the FETCH only — a
          // `prepend` fault (overflow / broken internals) stays FAIL-LOUD below.
          if (!(err instanceof ORPCError && err.code === "NOT_FOUND"))
            opts.onError(err);
          return;
        }
        if (!stillValid()) return;
        // A foreign-resize reflow renumbered the mirror since our cursor was
        // seeded: our absolute `before` no longer names the same row, so the host
        // served nothing and told us to halt. Pause (forget the cursor, bump the
        // local epoch) rather than splice a duplicated/skipped band — a fresh
        // snapshot re-seeds a valid cursor + epoch (F3). Fail-open on an older
        // host, which omits `stale`.
        if (res.stale) {
          pause();
          return;
        }
        // The server advanced the cursor from `before` to `res.topLine`, so it
        // consumed `before - res.topLine` mirror rows for this chunk. Hand that
        // span to the prepend so a range whose trailing blanks `serialize`
        // trimmed still occupies its full height (F10) — the client derives the
        // count from the two cursors it already holds, no wire field needed.
        const servedRows = before - res.topLine;
        // prepend re-checks `stillValid` after its own async replay, before the
        // splice; re-check here too before committing the cursor.
        const inserted = await prepend(term, res.chunk, stillValid, servedRows);
        if (!stillValid()) return;
        cursor = res.topLine;
        exhausted = res.exhausted;
        before = res.topLine;
        if (exhausted || inserted > 0) return;
      }
    } finally {
      inFlight = false;
    }
  }

  const onScroll = term.onScroll(() => void maybeBackfill());
  const onResize = term.onResize(() => {
    // A WIDTH change reflows the buffer, invalidating the absolute cursor; pause
    // until the next snapshot re-seeds. A height-only change is harmless.
    if (term.cols !== lastCols) {
      lastCols = term.cols;
      pause();
    }
  });

  return {
    seed(topLine, reflowEpoch) {
      cursor = topLine;
      seedEpoch = reflowEpoch;
      exhausted = false;
      epoch++;
    },
    reset() {
      pause();
    },
    dispose() {
      // Invalidate any in-flight fetch so its continuation can't splice onto the
      // xterm Terminal.tsx is about to dispose — `stillValid` reads `disposed`.
      disposed = true;
      epoch++;
      onScroll.dispose();
      onResize.dispose();
    },
  };
}
