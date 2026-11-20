import { parseLoopbackUrl, WEB_URL_PATTERN } from "@kolu/url-shape";
import { snapToWrapHead } from "@kolu/xterm-kit";
import type { TerminalId } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { createStore, produce } from "solid-js/store";

/** Rows read per turn before yielding. */
export const SCAN_CHUNK_LINES = 2_000;

/** At most one scan per this many ms while output flows — a burst is one scan. */
const SCAN_DELAY_MS = 250;

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

export const MAX_TRACKED_PORTS = 512;

export function printedPortsOf(id: TerminalId): readonly number[] {
  return printed[id] ?? [];
}

function record(id: TerminalId, found: ReadonlySet<number>): void {
  const prior = printed[id] ?? [];
  if ([...found].every((port) => prior.includes(port))) return;
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
  notePrepended(): void;
  /** Stop, and forget this terminal's index. */
  dispose(): void;
}

interface PrependDebt {
  /** A backfill spliced rows in above everything — the index owes a pass from row 0. */
  owe(): void;
  owed(): boolean;
  startedFromTop(): void;
  startedMidway(): void;
  /** A completed pass pays off every prepend it started from row 0 after. */
  settle(): void;
}

function createPrependDebt(): PrependDebt {
  let seen = 0;
  let read = 0;
  let passFrom: number | undefined;
  return {
    owe: () => {
      seen += 1;
    },
    owed: () => seen > read,
    startedFromTop: () => {
      passFrom = seen;
    },
    startedMidway: () => {
      passFrom = undefined;
    },
    settle: () => {
      if (passFrom !== undefined) read = Math.max(read, passFrom);
      passFrom = undefined;
    },
  };
}

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
  const prepends = createPrependDebt();
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

  function scan(): void {
    cancelPending = undefined;
    const buf = term.buffer.active;
    if (buf.type !== "normal") return;
    let start: number;
    if (cont !== undefined) {
      start = live(cont) ? cont.line : 0;
      cont.dispose();
      cont = undefined;
    } else if (resume === undefined || prepends.owed()) {
      start = 0;
      prepends.startedFromTop();
    } else {
      start = snapToWrapHead(buf, live(resume) ? resume.line : 0);
      prepends.startedMidway();
    }
    const end = Math.min(buf.length, start + SCAN_CHUNK_LINES);
    const found = new Set<number>();
    const take = (text: string): void => {
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
    prepends.settle();
    resume?.dispose();
    resume = markAt(snapToWrapHead(buf, buf.baseY));
    if (prepends.owed()) request(0);
  }

  const writes = term.onWriteParsed(() => request(SCAN_DELAY_MS));
  request(0);

  return {
    notePrepended: () => {
      prepends.owe();
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
