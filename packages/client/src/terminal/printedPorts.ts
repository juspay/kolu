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
 * Which hostnames count as loopback is `@kolu/url-shape`'s decision, not this
 * file's: the pattern below only finds URL-shaped candidates, and
 * `parseLoopbackUrl` — the same judge the click path uses — keeps the ones that
 * are.
 */

import { parseLoopbackUrl } from "@kolu/url-shape";
import type { TerminalId } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";

/** Rows read per turn before yielding. */
export const SCAN_CHUNK_LINES = 2_000;

/** How long output must pause before a scan runs — a stream of writes is one scan. */
export const SCAN_DELAY_MS = 250;

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

/** URL-shaped candidates. Deliberately loose: the judge is `parseLoopbackUrl`. */
const URL_CANDIDATE = /https?:\/\/[^\s"'<>`]+/gi;

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

/** The ports `id` has printed a loopback URL for, ascending. Reactive. */
export function printedPortsOf(id: TerminalId): readonly number[] {
  return printed[id] ?? [];
}

function record(id: TerminalId, found: ReadonlySet<number>): void {
  if (found.size === 0) return;
  const prior = printed[id] ?? [];
  const next = [...new Set([...prior, ...found])].sort((a, b) => a - b);
  // A re-scan of an already-indexed line finds nothing new; writing the same
  // list would still notify every reader.
  if (next.length !== prior.length) setPrinted(id, next);
}

/** Index what `term` prints, for as long as the returned disposer is not called.
 *  Disposing forgets the terminal's index: a remount re-reads its buffer, which
 *  a restore has already refilled. */
export function trackPrintedPorts(
  term: ScannableTerminal,
  id: TerminalId,
  schedule: (run: () => void, ms: number) => () => void = (run, ms) => {
    const t = setTimeout(run, ms);
    return () => clearTimeout(t);
  },
): () => void {
  /** Marks where the next scan resumes: the viewport top at the last scan. */
  let resume: ReturnType<ScannableTerminal["registerMarker"]>;
  let cancelPending: (() => void) | undefined;

  /** The first row of the logical line that `y` belongs to. */
  const logicalStart = (y: number): number => {
    const buf = term.buffer.active;
    let row = y;
    while (row > 0 && buf.getLine(row)?.isWrapped === true) row -= 1;
    return row;
  };

  /** Scan from `from` exactly, or — when absent — from the start of the last
   *  logical line a previous scan saw. */
  const scan = (from: number | undefined): void => {
    cancelPending = undefined;
    const buf = term.buffer.active;
    if (buf.type !== "normal") return;
    const start =
      from ??
      logicalStart(
        resume !== undefined && !resume.isDisposed ? resume.line : 0,
      );
    const end = Math.min(buf.length, start + SCAN_CHUNK_LINES);
    const found = new Set<number>();
    let line = "";
    let lineStart = start;
    for (let y = start; y < end; y++) {
      const row = buf.getLine(y);
      if (row === undefined) continue;
      if (row.isWrapped && y !== start) {
        line += row.translateToString(true);
        continue;
      }
      for (const port of portsInText(line)) found.add(port);
      line = row.translateToString(true);
      lineStart = y;
    }
    if (end < buf.length) {
      // The last logical line may straddle the chunk edge. When it started
      // inside this chunk, it is NOT read here — half a URL can name the wrong
      // port (`:51` of `:5173`) — and the next slice starts at its first row.
      // Only a single logical line longer than a whole chunk is read in halves.
      const next = lineStart > start ? lineStart : end;
      if (next === end) {
        for (const port of portsInText(line)) found.add(port);
      }
      record(id, found);
      cancelPending = schedule(() => scan(next), 0);
      return;
    }
    for (const port of portsInText(line)) found.add(port);
    record(id, found);
    // Resume from the top of the VIEWPORT next time, not from the last row read.
    // A program may redraw anywhere inside the viewport by moving the cursor up
    // (Claude Code re-renders its live region exactly so), which rewrites rows
    // this scan already passed; only rows that have scrolled above `baseY` are
    // immutable. Re-reading one screenful per scan is the price, and it is small.
    resume?.dispose();
    resume = term.registerMarker(
      logicalStart(buf.baseY) - (buf.baseY + buf.cursorY),
    );
  };

  const writes = term.onWriteParsed(() => {
    if (cancelPending !== undefined) return;
    cancelPending = schedule(() => scan(undefined), SCAN_DELAY_MS);
  });
  // The buffer may already hold a restored scrollback before the first write.
  cancelPending = schedule(() => scan(undefined), 0);

  return () => {
    writes.dispose();
    cancelPending?.();
    cancelPending = undefined;
    resume?.dispose();
    setPrinted(
      produce((index) => {
        delete index[id];
      }),
    );
  };
}
