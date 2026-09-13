/**
 * Which loopback ports each terminal has PRINTED a URL for — the index that lets
 * a tile claim a server that detached from it.
 *
 * `odu web-daemon`, anything under `setsid`, a double-forked dev server: each
 * reparents to init and leaves the terminal's process subtree, so the subtree
 * scan cannot attribute its port to the tile any more. What still ties the two
 * together is the URL the terminal printed. This module reads it back off the
 * terminal's own buffer.
 *
 * It is an index of TEXT, and it never creates a fact. A port lands in a tile's
 * Ports section only when the host's scan positively holds a listener on it
 * (`portGroups`); a printed URL with nothing behind it produces no row. The
 * printed-URL card — the one place a print is discussed on its own — keeps doing
 * its own click-time join.
 *
 * ## How the buffer is read
 *
 * Incrementally, from a MARKER: xterm moves a marker with the buffer as
 * scrollback trims, so "where to resume" survives a burst that pushes old lines
 * out. Each scan resumes at the top of the viewport it last saw — the only rows
 * a program can still rewrite — and joins soft-wrapped rows so a URL the
 * terminal wrapped is read whole. Scans are coalesced behind a short delay
 * after output and walk at most {@link SCAN_CHUNK_LINES} rows per turn, so a
 * restored 50 000-line scrollback is read in slices rather than in one frame.
 *
 * Only the NORMAL buffer is read. A full-screen program's alternate buffer is a
 * picture of a UI, not a log of what the terminal printed.
 *
 * What counts as a URL and which hostnames count as loopback are both
 * `@kolu/url-shape`'s decisions, not this file's: `WEB_URL_PATTERN` is the same
 * grammar the terminal's link underlining uses, and `parseLoopbackUrl` is the
 * same judge the click path uses.
 *
 * ## What it cannot see
 *
 * The index is as long as the browser's buffer, and a remounted terminal (a
 * reload, a host switch, a wake) holds only the attach snapshot's recent rows
 * until the user scrolls back — scrolling back backfills older rows, and those
 * are read as they arrive (the backfill controller reports each splice). A detached server whose URL was printed further
 * up than that is still listed — under "elsewhere on this host" instead of under
 * the terminal — and the printed-URL card still finds it on click. Keeping the
 * claim across a remount needs the index where the output lives, host-side
 * (Atlas `port-forwarding`, PRT6).
 *
 * Per-terminal, the index also caps at {@link MAX_TRACKED_PORTS} distinct
 * ports, evicting the least-recently-seen ones — a long-lived terminal that
 * prints many distinct ports over its life must not grow this store forever.
 */

import { parseLoopbackUrl, WEB_URL_PATTERN } from "@kolu/url-shape";
import { snapToWrapHead } from "@kolu/xterm-kit";
import type { TerminalId } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";

/** Rows read per turn before yielding. */
export const SCAN_CHUNK_LINES = 2_000;

/** At most one scan per this many ms while output flows — a burst is one scan. */
const SCAN_DELAY_MS = 250;

/** The slice of xterm this module reads, so the scanner is testable without a
 *  DOM. `@xterm/xterm`'s `Terminal` satisfies it structurally. */
export interface ScannableTerminal {
  readonly buffer: {
    readonly active: {
      readonly type: "normal" | "alternate";
      readonly length: number;
      readonly baseY: number;
      readonly cursorY: number;
      getLine(y: number):
        | {
            readonly isWrapped: boolean;
            translateToString(trim?: boolean): string;
          }
        | undefined;
    };
  };
  onWriteParsed(listener: () => void): { dispose(): void };
  registerMarker(
    cursorYOffset?: number,
  ):
    | { readonly line: number; readonly isDisposed: boolean; dispose(): void }
    | undefined;
}

/** Every URL in a line, by the terminal's own link grammar. */
const URL_CANDIDATE = new RegExp(WEB_URL_PATTERN.source, "g");

/** Every loopback port a line of text names a URL for. */
export function portsInText(text: string): number[] {
  const ports: number[] = [];
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const loopback = parseLoopbackUrl(match[0]);
    if (loopback !== null) ports.push(loopback.port);
  }
  return ports;
}

const [printed, setPrinted] = createRoot(() =>
  createStore<Record<TerminalId, readonly number[]>>({}),
);

/** Distinct ports tracked per terminal, capped so a session that keeps a
 *  terminal open for hours and prints an unbounded number of distinct
 *  dev-server ports (a loop that picks a new one each run, say) cannot grow
 *  this index without limit for the terminal's whole lifetime — the only
 *  eviction otherwise is the terminal's own `dispose()`. An ordinary session
 *  prints a handful of ports; this is far above that. */
export const MAX_TRACKED_PORTS = 512;

/** The ports `id` has printed a loopback URL for, oldest first (subject to the
 *  {@link MAX_TRACKED_PORTS} cap — a full index evicts its least-recently-seen
 *  entries). Reactive. */
export function printedPortsOf(id: TerminalId): readonly number[] {
  return printed[id] ?? [];
}

function record(id: TerminalId, found: ReadonlySet<number>): void {
  const prior = printed[id] ?? [];
  // The steady state — a URL still on screen, re-read every pass — finds
  // nothing new, and must allocate nothing and notify no reader.
  if ([...found].every((port) => prior.includes(port))) return;
  // Ports this pass re-saw move to the back (most-recently-seen); the cap
  // below then evicts from the front, so a port still being printed survives
  // and a stale one — the module has no way to know if its listener is even
  // still alive — is the one dropped first.
  const stale = prior.filter((port) => !found.has(port));
  const merged = [...stale, ...[...found].sort((a, b) => a - b)];
  const capped =
    merged.length > MAX_TRACKED_PORTS
      ? merged.slice(merged.length - MAX_TRACKED_PORTS)
      : merged;
  setPrinted(id, capped);
}

/** What a tracked terminal's owner can tell the index. */
export interface PrintedPortsTracker {
  /** Rows were spliced in above everything — a scrollback backfill. A splice
   *  fires no write, so the backfill controller says so (`onPrepended`). */
  notePrepended(): void;
  /** Stop, and forget this terminal's index. */
  dispose(): void;
}

/** Index what `term` prints, until `dispose`. Disposing forgets the terminal's
 *  index; a remount re-reads whatever its buffer holds by then (see "What it
 *  cannot see" above). */
export function trackPrintedPorts(
  term: ScannableTerminal,
  id: TerminalId,
  schedule: (run: () => void, ms: number) => () => void = (run, ms) => {
    const t = setTimeout(run, ms);
    return () => clearTimeout(t);
  },
): PrintedPortsTracker {
  type Marker = NonNullable<ReturnType<ScannableTerminal["registerMarker"]>>;
  /** Where the next pass resumes: the viewport top at the last completed pass. */
  let resume: Marker | undefined;
  /** Prepends reported, and prepends a completed pass has read past. A pass clears
   *  a prepend only if it STARTED at row 0 after that prepend was seen — so a
   *  prepend landing mid-pass (its rows above a continuation that has already
   *  moved on) is still owed a pass from the top. */
  let prependsSeen = 0;
  let prependsRead = 0;
  /** The `prependsSeen` a pass in progress started from row 0 with, if it did. */
  let passFromTop: number | undefined;
  /** Where an in-progress pass continues after yielding. A MARKER, not a row
   *  number: output that trims the buffer between two chunks moves every row,
   *  and a captured number would skip the rows that moved under it. */
  let cont: Marker | undefined;
  let cancelPending: (() => void) | undefined;

  /** A marker on absolute row `y` — xterm places markers relative to the cursor. */
  const markAt = (y: number): Marker | undefined => {
    const buf = term.buffer.active;
    return term.registerMarker(y - (buf.baseY + buf.cursorY));
  };
  const live = (m: Marker | undefined): m is Marker =>
    m !== undefined && !m.isDisposed;

  const request = (ms: number): void => {
    if (cancelPending === undefined) cancelPending = schedule(scan, ms);
  };

  /** One chunk of a pass. A new pass starts at row 0 when a prepend is owed,
   *  otherwise at the logical line holding the last viewport top; a continuing
   *  pass starts where its marker now sits (the top, if the rows it marked were
   *  trimmed away — re-reading is safe, skipping is not). */
  function scan(): void {
    cancelPending = undefined;
    const buf = term.buffer.active;
    if (buf.type !== "normal") return;
    let start: number;
    if (cont !== undefined) {
      start = live(cont) ? cont.line : 0;
      cont.dispose();
      cont = undefined;
    } else if (resume === undefined || prependsSeen > prependsRead) {
      start = 0;
      passFromTop = prependsSeen;
    } else {
      start = snapToWrapHead(buf, live(resume) ? resume.line : 0);
      passFromTop = undefined;
    }
    const end = Math.min(buf.length, start + SCAN_CHUNK_LINES);
    const found = new Set<number>();
    const take = (text: string): void => {
      // Most rows hold no URL; skip the pattern for them.
      if (!text.includes("://")) return;
      for (const port of portsInText(text)) found.add(port);
    };
    let line = "";
    let lineStart = start;
    for (let y = start; y < end; y++) {
      const row = buf.getLine(y);
      if (row === undefined) continue;
      if (row.isWrapped && y !== start) {
        line += row.translateToString(true);
        continue;
      }
      take(line);
      line = row.translateToString(true);
      lineStart = y;
    }
    if (end < buf.length) {
      // The last logical line may straddle the chunk edge. When it started
      // inside this chunk, it is NOT read here — half a URL can name the wrong
      // port (`:51` of `:5173`) — and the next slice starts at its first row.
      // Only a single logical line longer than a whole chunk is read in halves.
      if (lineStart === start) {
        take(line);
        cont = markAt(end);
      } else {
        cont = markAt(lineStart);
      }
      record(id, found);
      cancelPending = schedule(scan, 0);
      return;
    }
    take(line);
    record(id, found);
    if (passFromTop !== undefined) {
      prependsRead = Math.max(prependsRead, passFromTop);
    }
    passFromTop = undefined;
    // Resume from the top of the VIEWPORT next time, not from the last row read.
    // A program may redraw anywhere inside the viewport by moving the cursor up
    // (Claude Code re-renders its live region exactly so), which rewrites rows
    // this scan already passed; only rows that have scrolled above `baseY` are
    // immutable. Re-reading one screenful per scan is the price, and it is small.
    resume?.dispose();
    resume = markAt(snapToWrapHead(buf, buf.baseY));
    // A prepend that landed while this pass ran is still owed its rows.
    if (prependsSeen > prependsRead) request(0);
  }

  const writes = term.onWriteParsed(() => request(SCAN_DELAY_MS));
  // The buffer may already hold a restored scrollback before the first write.
  request(0);

  return {
    notePrepended: () => {
      prependsSeen += 1;
      request(SCAN_DELAY_MS);
    },
    dispose: () => {
      writes.dispose();
      cancelPending?.();
      cancelPending = undefined;
      resume?.dispose();
      cont?.dispose();
      setPrinted(
        produce((index) => {
          delete index[id];
        }),
      );
    },
  };
}
