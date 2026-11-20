import { Terminal as XTerm } from "@xterm/xterm";

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
  buffer: BufferInternal;
  buffers: { normal: BufferInternal };
  _bufferService: { _onScroll: { fire(ydisp: number): void } };
}

export interface ScratchTerminal {
  readonly cols: number;
  readonly rows: number;
  write(data: string, callback?: () => void): void;
  dispose(): void;
}

function coreOf(term: { cols: number }): CoreInternal {
  const core = (term as unknown as { _core?: CoreInternal })._core;
  if (!core?.buffers?.normal?.lines || !core._bufferService?._onScroll?.fire) {
    throw new Error(
      "xterm internals contract broken: scrollback-backfill cannot reach _core.buffers.normal.lines / _bufferService._onScroll.fire",
    );
  }
  return core;
}

function contentRows(buf: BufferInternal): number {
  return buf.ybase + buf.y + (buf.x > 0 ? 1 : 0);
}

function stealContentLines(
  scratch: ScratchTerminal,
  rowsToMaterialize: number,
): BufferLineInternal[] {
  const buf = coreOf(scratch).buffer;
  const n = Math.max(contentRows(buf), rowsToMaterialize);
  const out: BufferLineInternal[] = [];
  for (let i = 0; i < n; i++) {
    const line = buf.lines.get(i);
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
export function defaultScratch(cols: number, rows: number): ScratchTerminal {
  return new XTerm({
    cols,
    rows,
    scrollback: 100_000,
    allowProposedApi: true,
  }) as unknown as ScratchTerminal;
}

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

export function isAltBufferActive(term: {
  buffer: { active: { type: string } };
}): boolean {
  return term.buffer.active.type === "alternate";
}

/** The outcome of a prepend, as a discriminated union so the caller can never
 *  conflate "nothing was consumed" with "consumed, inserted 0 rows":
 *   - `inserted` — the chunk was consumed; `rows` is the count spliced in (0 for
 *     an exhausted/empty range, ≥1 for real content). The caller ADVANCES its
 *     cursor to `res.topLine`.
 *   - `skipped`  — nothing was consumed (the alt buffer was active, or the fetch
 *     went stale during the async replay). The caller must NOT advance its
 *     cursor: the band is still owed and a later scroll re-fetches it. */
export type PrependResult =
  | { kind: "inserted"; rows: number }
  | { kind: "skipped" };

/** Prepend `rawChunk` (older raw PTY bytes, from kaval's `getHistory`) above the
 *  existing content of the live terminal. `servedRows` is the mirror-range row
 *  count the server consumed for this chunk (`before - topLine`); the prepend
 *  materializes that many rows so a range whose trailing blanks `serialize`
 *  trimmed still occupies its full height (see `stealContentLines`). Returns an
 *  `inserted` result carrying the number of rows spliced in (M) — the caller
 *  advances its own bookkeeping by this. Returns `{kind:"inserted", rows:0}`
 *  without touching the buffer when the range is truly empty (`servedRows === 0`,
 *  the exhausted reply). Returns `{kind:"skipped"}` — a distinct arm the caller
 *  treats as "not consumed, don't advance the cursor" — when the alt buffer is
 *  active or the `shouldCommit` guard rejects the late splice. An empty chunk
 *  that still spans rows (`servedRows > 0`, an all-blank range) materializes
 *  those blank rows rather than skipping.
 *
 *  THROWS (never silently degrades) when xterm's internal shape is missing or
 *  the prepend would overflow the live buffer's `maxLength` — see the file
 *  header. Clears the selection first: xterm's `SelectionService` listens only
 *  to `onTrim`, not `onInsert`, so an active selection would otherwise point at
 *  the wrong rows after the shift (MVP: cleared, not preserved).
 *
 *  `shouldCommit` is re-checked AFTER the scratch replay (an async task boundary)
 *  and BEFORE the buffer splice: replaying the chunk suspends on xterm's write
 *  callback, during which a `reset()` (fresh-snapshot re-attach), a width
 *  `resize` (reflow), or an in-band RIS can land — splicing old-width lines into
 *  a reflowed buffer, or scrollback onto a just-reset one, is corruption.
 *  Returning `false` makes the prepend a clean no-op (returns `{kind:"skipped"}`,
 *  which the caller treats as "not consumed"), the same discard the caller's
 *  generation guard performs for a stale fetch. */
export async function prependScrollback(
  term: XTerm,
  rawChunk: string,
  servedRows: number,
  opts?: {
    makeScratch?: (cols: number, rows: number) => ScratchTerminal;
    shouldCommit?: () => boolean;
  },
): Promise<PrependResult> {
  if (rawChunk.length === 0 && servedRows === 0)
    return { kind: "inserted", rows: 0 };
  if (isAltBufferActive(term)) return { kind: "skipped" };

  const lines = await replayToLines(
    rawChunk,
    term.cols,
    term.rows,
    servedRows,
    opts?.makeScratch ?? defaultScratch,
  );
  const m = lines.length;
  if (m === 0) return { kind: "inserted", rows: 0 };
  if (opts?.shouldCommit && !opts.shouldCommit()) return { kind: "skipped" };

  const core = coreOf(term);
  const buf = core.buffers.normal;

  if (buf.lines.length + m > buf.lines.maxLength) {
    throw new Error(
      `scrollback-backfill: prepend would overflow (${buf.lines.length} + ${m} > ${buf.lines.maxLength}); client scrollback is undersized for the mirror`,
    );
  }

  term.clearSelection();

  buf.lines.splice(0, 0, ...lines);

  buf.ybase += m;
  buf.ydisp += m;
  buf.savedY += m;

  core._bufferService._onScroll.fire(buf.ydisp);
  term.refresh(0, term.rows - 1);

  return { kind: "inserted", rows: m };
}

export const HISTORY_CHUNK_ROWS = 500;

/** Private OSC ident for the snapshot-seed seam. An OSC ident is NOT an
 *  out-of-band channel — it is ordinary PTY-controlled output, and any terminal
 *  program can emit `ESC ] 60697 …`, so a high "currently unused" number cannot
 *  make a collision impossible (F12). Provenance is carried instead by the
 *  unguessable per-frame TOKEN in the payload (`seamFor`): the handler trusts a
 *  payload only when it matches the next pending seed's token, and ignores any
 *  other output on this ident. Exported for the contract-pin test. */
export const SNAPSHOT_SEED_SEAM_OSC = 60697;

function seamFor(token: string): string {
  return `\x1b]${SNAPSHOT_SEED_SEAM_OSC};${token}\x07`;
}

/** Mint one unguessable per-frame seam token: 128 bits from `getRandomValues`,
 *  hex-encoded (BEL-safe, no OSC-terminator bytes). Deliberately NOT
 *  `crypto.randomUUID()` — that is restricted to SECURE contexts, and kolu is
 *  reached over plain HTTP on a LAN, where `randomUUID` is absent and would throw
 *  before the frame is written, wedging every attach (F14). `getRandomValues` is
 *  available in insecure contexts too, and its cryptographic unpredictability is
 *  what makes the token unforgeable by PTY output on the same OSC ident (F12) —
 *  `Math.random()` would not. */
function mintSeedToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

interface PendingSeed {
  carriesReset: boolean;
  token: string;
  capture: (generation: number) => void;
}

interface SeedQueue {
  push: (seed: PendingSeed) => void;
  claim: (token: string) => PendingSeed | null;
  clear: () => void;
}

function createSeedQueue(): SeedQueue {
  const seeds: PendingSeed[] = [];
  return {
    push: (seed) => {
      seeds.push(seed);
    },
    claim: (token) => {
      const front = seeds[0];
      if (!front || front.token !== token) return null;
      seeds.shift();
      return front;
    },
    clear: () => {
      seeds.length = 0;
    },
  };
}

export type HistoryChunk =
  | { kind: "chunk"; chunk: string; topLine: number; exhausted: boolean }
  /** The reflow epoch the controller stamped on the fetch no longer matches the
   *  mirror's current generation — a width reflow (this OR a foreign attach's
   *  resize) renumbered absolute rows since the cursor was seeded, so NOTHING is
   *  served and the controller HALTS backfill until a fresh snapshot re-seeds
   *  (F3). Only reachable when the controller sent an epoch (fail-open otherwise). */
  | { kind: "stale" };

export interface BackfillController {
  /** Forget the cursor (paused) — call when xterm is reset for a fresh snapshot,
   *  before the new snapshot's `consumeSnapshotFrame`. The ONLY seed path is
   *  `consumeSnapshotFrame` (reset+seed fused): there is deliberately no bare
   *  `seed`, so a seed-without-reset transition is unrepresentable (F3). */
  reset(): void;
  /** Consume a fresh `snapshot` frame (initial attach OR a mid-stream overflow
   *  re-attach) as ONE indivisible act, so a call site cannot express
   *  seed-without-reset. Synchronously INVALIDATES now — forgets the cursor and
   *  bumps the generation, killing any in-flight fetch so its continuation can't
   *  splice across the RIS reset this frame carries — and RETURNS a committer to
   *  run once the snapshot has PARSED into the buffer (from xterm's write
   *  callback), which seeds the cursor from the frame's `topLine` + reflow
   *  generation. Deferring the seed to post-parse keeps the snapshot's own
   *  `onScroll` (as `ydisp` climbs from 0) from firing an unsolicited fetch
   *  mid-parse; the synchronous invalidation fires NOW regardless of scroll-lock,
   *  and the committer rides the same write callback the lock preserves on flush.
   *
   *  `carriesReset` — whether this frame's `data` LEADS with a RIS (`ESC c`) that
   *  xterm will parse into the controller's own reset handler: true for an
   *  overflow re-attach (`TERMINAL_RESET + snapshot`), false for the INITIAL
   *  attach (bare snapshot). The reset the frame carries and a foreign live-delta
   *  RIS reach the SAME esc handler, which pauses on both. So the committer's
   *  baseline is captured at the frame's snapshot-seed seam (byte position), and
   *  `carriesReset` tells that capture to PREDICT the one extra generation bump
   *  the frame's own leading RIS makes — so the frame's own RIS doesn't read as an
   *  invalidation that revokes the committer this call arms (F11).
   *
   *  Returns BOTH the deferred `commit` (run from the frame's write callback,
   *  once parsed) AND the `seam` bytes Terminal.tsx must prepend to this frame's
   *  data — the seam carries this frame's own unguessable token so program output
   *  on the same OSC ident can't drive the controller (F12). `commit` also no-ops
   *  when an out-of-band lifecycle invalidation (resize / newer snapshot /
   *  explicit reset / dispose) landed AFTER receipt but BEFORE the seam parsed:
   *  the seam-only baseline would otherwise fold that bump in and forgive it,
   *  reopening the receipt-to-parse race (F2). */
  consumeSnapshotFrame(
    topLine: number,
    reflowEpoch: number | undefined,
    carriesReset: boolean,
  ): { commit: () => void; seam: string };
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
    /** Recognise the ONE fetch failure that is expected TEARDOWN rather than a
     *  fault: the terminal this backfill reads from is GONE (killed PTY, exited
     *  process), so the host rejects the history read with the tagged error its
     *  own surface DECLARES on that procedure — padi's `TerminalNotFound` over
     *  the browser wire, kaval's `PtyNotFound` over a direct link. `true`
     *  swallows it silently (a later scroll retries); everything else goes to
     *  {@link onError}. */
    isTerminalGone: (err: unknown) => boolean;
    /** Surface a fetch failure that is NOT the expected teardown
     *  {@link isTerminalGone} names. Called for transport / auth / schema /
     *  server faults so backfill can't silently leave a hole — the caller toasts
     *  it; a later scroll retries. REQUIRED: the controller exposes no other
     *  error accessor, so an omitted handler would silently recreate the swallow
     *  this exists to prevent (fail-loud). A caller that genuinely wants to
     *  ignore faults passes an explicit no-op `() => {}` — a visible decision,
     *  not a missing one. */
    onError: (err: unknown) => void;
    /** Rows were spliced in above everything — told once per committed insert,
     *  with its row count. A splice fires no write event (only a scroll), so a
     *  consumer that reads the buffer — kolu's printed-port index — cannot tell a
     *  backfill from the user scrolling without being told. REQUIRED, like
     *  {@link onError}: a caller with nothing to do passes `() => {}`. */
    onPrepended: (rows: number) => void;
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
    ) => Promise<PrependResult>;
  },
): BackfillController {
  const prepend =
    opts.prepend ??
    ((t, c, shouldCommit, servedRows) =>
      prependScrollback(t, c, servedRows, { shouldCommit }));
  let cursor: number | null = null;
  let seedEpoch: number | undefined;
  let exhausted = false;
  let inFlight = false;
  let generation = 0;
  let lifecycleToken = 0;
  let disposed = false;
  let lastCols = term.cols;
  const pendingSeeds = createSeedQueue();

  function pause(): void {
    cursor = null;
    exhausted = false;
    generation++;
  }

  function pauseLifecycle(): void {
    pause();
    lifecycleToken++;
  }

  async function maybeBackfill(): Promise<void> {
    if (cursor === null || exhausted || inFlight || disposed) return;
    if (isAltBufferActive(term)) return;
    const triggerRows = opts.triggerRows ?? term.rows * 2;
    if (term.buffer.active.viewportY > triggerRows) return;

    inFlight = true;
    let before = cursor;
    const myGeneration = generation;
    const fetchCols = term.cols;
    const stillValid = () =>
      !disposed && generation === myGeneration && term.cols === fetchCols;
    try {
      for (;;) {
        if (isAltBufferActive(term)) return;
        let res: HistoryChunk;
        try {
          res = await opts.fetch(before, HISTORY_CHUNK_ROWS, seedEpoch);
        } catch (err) {
          if (!opts.isTerminalGone(err)) opts.onError(err);
          return;
        }
        if (!stillValid()) return;
        if (res.kind === "stale") {
          pause();
          return;
        }
        const servedRows = before - res.topLine;
        let result: PrependResult;
        try {
          result = await prepend(term, res.chunk, stillValid, servedRows);
        } catch (err) {
          pause();
          opts.onError(err);
          return;
        }
        if (!stillValid()) return;
        if (result.kind === "skipped") return;
        if (result.rows > 0) opts.onPrepended(result.rows);
        cursor = res.topLine;
        exhausted = res.exhausted;
        before = res.topLine;
        if (exhausted || result.rows > 0) return;
      }
    } finally {
      inFlight = false;
    }
  }

  const onScroll = term.onScroll(() => void maybeBackfill());
  const onResize = term.onResize(() => {
    if (term.cols !== lastCols) {
      lastCols = term.cols;
      pauseLifecycle();
    }
  });
  const onRisReset = term.parser.registerEscHandler({ final: "c" }, () => {
    pause();
    return false;
  });

  const onSeedSeam = term.parser.registerOscHandler(
    SNAPSHOT_SEED_SEAM_OSC,
    (payload) => {
      const seed = pendingSeeds.claim(payload);
      if (seed) seed.capture(generation + (seed.carriesReset ? 1 : 0));
      return true;
    },
  );

  function applySeed(topLine: number, reflowEpoch: number | undefined): void {
    cursor = topLine;
    seedEpoch = reflowEpoch;
    exhausted = false;
    generation++;
  }

  return {
    reset() {
      pauseLifecycle();
      pendingSeeds.clear();
    },
    consumeSnapshotFrame(topLine, reflowEpoch, carriesReset) {
      pauseLifecycle();
      const myLifecycle = lifecycleToken;
      const token = mintSeedToken();
      let baseline: number | null = null;
      pendingSeeds.push({
        carriesReset,
        token,
        capture: (g) => {
          baseline = g;
        },
      });
      const commit = () => {
        if (
          disposed ||
          baseline === null ||
          generation !== baseline ||
          lifecycleToken !== myLifecycle
        )
          return;
        applySeed(topLine, reflowEpoch);
      };
      return { commit, seam: seamFor(token) };
    },
    dispose() {
      disposed = true;
      generation++;
      pendingSeeds.clear();
      onScroll.dispose();
      onResize.dispose();
      onRisReset.dispose();
      onSeedSeam.dispose();
    },
  };
}
