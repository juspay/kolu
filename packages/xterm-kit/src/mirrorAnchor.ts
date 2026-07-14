/** Mirror anchoring — absolute mirror-line coordinates over a long-lived xterm
 *  mirror, stable across scrollback eviction and a RIS (`ESC c`) buffer swap.
 *
 *  Lifted verbatim from kaval's `ptyHost` `Entry` bookkeeping (behavior-identical
 *  by construction): the `mirrorBaseLine` eviction origin + its `onTrim` pin, the
 *  RIS identity re-anchor, and the `reflowEpoch` bump. Runtime-neutral — it reads
 *  only xterm privates through the fail-loud {@link normalLinesOf} door and takes
 *  the mirror as a parameter, so a Node daemon (kaval) consumes it with no
 *  solid-js and no browser assumptions. The client's backfill controller relies
 *  on the same absolute-line discipline on the browser side.
 *
 *  FAIL LOUD, deliberately: the reach here mutates absolute coordinates, so a
 *  silently-missing `onTrim`/`length` (which would freeze the origin or poison it
 *  with `NaN` while the buffer renumbers underneath) THROWS, caught by the
 *  contract-pin tests (`xtermMirrorContract.test.ts` headless, and the client's
 *  `scrollbackBackfill.test.ts` browser twin) as red CI, never as user-visible
 *  scrollback corruption. */

/** The one reach into an xterm mirror's privates the anchor needs: the normal
 *  buffer's line `CircularList` — the reach the eviction pin and the RIS-reset
 *  detector share. `length` is the current row count (read to advance the origin
 *  past a reset's discarded rows); `onTrim` fires with the count evicted off the
 *  top when scrollback overflows, the ONLY faithful source of "lines evicted" —
 *  the number the origin accumulates so an absolute cursor survives eviction. A
 *  full reset replaces this object wholesale, which is why identity (not just
 *  `length`) is tracked. No public API exposes these. */
interface NormalLinesRef {
  length: number;
  onTrim(l: (n: number) => void): { dispose(): void };
}

/** Reach the normal buffer's line list, or THROW — a missing shape is a broken
 *  internals contract, never a silent degrade (the pin/base arithmetic is unsafe
 *  without it). Both pinned members are validated: `onTrim` must be callable, and
 *  `length` a nonnegative integer — the RIS re-anchor does `baseLine +=
 *  lines.length`, so a missing/garbage `length` must fail loud here, not silently
 *  poison the absolute cursor with `NaN`. */
function normalLinesOf(term: object): NormalLinesRef {
  const lines = (
    term as {
      _core?: { buffers?: { normal?: { lines?: unknown } } };
    }
  )._core?.buffers?.normal?.lines as Partial<NormalLinesRef> | undefined;
  if (
    typeof lines?.onTrim !== "function" ||
    !Number.isInteger(lines?.length) ||
    (lines.length as number) < 0
  ) {
    throw new Error(
      "xterm internals contract broken: _core.buffers.normal.lines.{length: int≥0, onTrim: fn} missing",
    );
  }
  return lines as NormalLinesRef;
}

/** Snap a start row back over any wrapped-line continuation rows to the logical
 *  line's HEAD (`isWrapped === false`; a blank line qualifies), so a serialize
 *  cut never bisects a soft-wrapped line — which would replay the continuation
 *  as a fresh hard line (the wrap flag is lost with no preceding row). The one
 *  home for the invariant a bounded-snapshot start and a history chunk top both
 *  enforce, so the two edges can't drift. */
export function snapToWrapHead(
  buffer: { getLine(i: number): { isWrapped: boolean } | undefined },
  start: number,
): number {
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  return start;
}

/** Absolute-line coordinates over one long-lived mirror. See the file header. */
export interface MirrorAnchor {
  /** Absolute-line origin: the running count of lines the mirror has retired off
   *  the top — the `onTrim` eviction total PLUS the length of any buffer a full
   *  RIS reset discarded wholesale. An absolute mirror-line index is
   *  `baseLine() + localBufferIndex`, the stable coordinate a history pager pages
   *  by. Only grows. */
  baseLine(): number;
  /** Monotonic reflow generation — bumped on a WIDTH resize ({@link bumpReflow})
   *  and a full RIS reset (detected in {@link reanchorIfReset}), the two events
   *  that renumber absolute rows. A cursor stamped under an older generation no
   *  longer names the same row, so a stale-generation history fetch is served
   *  nothing (halt-not-corrupt). Only grows. */
  reflowEpoch(): number;
  /** Detect a RIS buffer swap by identity and re-anchor. Call after each parse
   *  (from the mirror's write callback). A full reset (RIS / `ESC c`, terminfo
   *  `rs1`) replaces the normal buffer's line list, silently orphaning the
   *  `onTrim` pin (the origin would freeze) and renumbering absolutes with NO
   *  resize. On a swap: advance the origin past the rows the old buffer held (new
   *  content gets fresh absolute numbers, never reused), re-subscribe the trim
   *  pin to the new list, and bump the generation so every outstanding cursor
   *  re-seeds. */
  reanchorIfReset(): void;
  /** Bump the reflow generation — call on a WIDTH resize (the other event that
   *  rewraps and renumbers absolute rows). A height-only or same-dims resize
   *  renumbers nothing and must NOT bump. */
  bumpReflow(): void;
  /** Dispose the live `onTrim` subscription. One stable teardown that disposes
   *  WHICHEVER handle is current — a RIS swap replaces the handle in place, so
   *  this stays a single indirection and never accumulates dead disposables. */
  dispose(): void;
}

/** Build a {@link MirrorAnchor} over `term` (a browser or headless xterm
 *  `Terminal`). Subscribes the eviction pin immediately; the caller drives
 *  {@link MirrorAnchor.reanchorIfReset} from its write callback and
 *  {@link MirrorAnchor.bumpReflow} from its resize path. */
export function createMirrorAnchor(term: object): MirrorAnchor {
  let baseLine = 0;
  let reflowEpoch = 0;
  let normalLines = normalLinesOf(term);
  // Track eviction: each time scrollback overflows and the oldest rows fall off,
  // advance the origin by the count trimmed. Re-used verbatim when a RIS reset
  // swaps the line list (below).
  const trimHandler = (evicted: number): void => {
    baseLine += evicted;
  };
  let trimDisposable = normalLines.onTrim(trimHandler);

  return {
    baseLine: () => baseLine,
    reflowEpoch: () => reflowEpoch,
    reanchorIfReset(): void {
      const currentLines = normalLinesOf(term);
      if (currentLines !== normalLines) {
        baseLine += normalLines.length;
        trimDisposable.dispose();
        normalLines = currentLines;
        trimDisposable = currentLines.onTrim(trimHandler);
        reflowEpoch++;
      }
    },
    bumpReflow(): void {
      reflowEpoch++;
    },
    dispose(): void {
      trimDisposable.dispose();
    },
  };
}
