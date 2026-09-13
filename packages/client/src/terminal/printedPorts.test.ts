/**
 * The printed-port index — what a terminal's own buffer says it printed.
 *
 * Driven against a fake buffer rather than a real xterm: the properties pinned
 * here are about WHICH rows get read and how they are joined, and a fake whose
 * rows, wrap flags and markers the test controls states them exactly.
 */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  portsInText,
  printedPortsOf,
  SCAN_CHUNK_LINES,
  type ScannableTerminal,
  trackPrintedPorts,
} from "./printedPorts";

describe("portsInText", () => {
  it("finds loopback URLs and ignores the rest", () => {
    expect(
      portsInText(
        "odu · http://127.0.0.1:18440/runs/0mtz  see https://github.com/x and http://localhost:5173/",
      ),
    ).toEqual([18440, 5173]);
  });

  it("uses the scheme default port when none is printed", () => {
    expect(portsInText("open http://localhost/ now")).toEqual([80]);
  });

  it("reads a URL followed by prose punctuation, as the link underline does", () => {
    // The shared link grammar never ends a URL on `.`, `,` or `)` — so "running
    // at http://localhost:3000." names port 3000 instead of failing to parse.
    expect(
      portsInText(
        "running at http://localhost:3000. (see http://127.0.0.1:4000), or http://[::1]:5000,",
      ),
    ).toEqual([3000, 4000, 5000]);
  });

  it("accepts every loopback spelling the click path accepts", () => {
    expect(portsInText("http://[::1]:3000 http://0.0.0.0:4000")).toEqual([
      3000, 4000,
    ]);
  });
});

/** A fake normal buffer. `rows` are [text, isWrapped]; the cursor sits on the
 *  last row and the viewport is `viewport` rows tall. Markers track a line index
 *  and shift when `trim` drops rows off the top, as xterm's do. */
function fakeTerminal(viewport = 3) {
  const rows: Array<[string, boolean]> = [];
  let onWrite: (() => void) | undefined;
  let onScroll: (() => void) | undefined;
  const markers: Array<{ line: number; isDisposed: boolean }> = [];
  let type: "normal" | "alternate" = "normal";
  const term: ScannableTerminal = {
    buffer: {
      active: {
        get type() {
          return type;
        },
        get length() {
          return rows.length;
        },
        get baseY() {
          return Math.max(0, rows.length - viewport);
        },
        get cursorY() {
          return Math.min(rows.length, viewport) - 1;
        },
        getLine: (y) => {
          const row = rows[y];
          return row === undefined
            ? undefined
            : {
                isWrapped: row[1],
                translateToString: () => row[0],
              };
        },
      },
    },
    onWriteParsed: (listener) => {
      onWrite = listener;
      return { dispose: () => (onWrite = undefined) };
    },
    onScroll: (listener) => {
      onScroll = listener;
      return { dispose: () => (onScroll = undefined) };
    },
    registerMarker: (offset = 0) => {
      const base = Math.max(0, rows.length - viewport);
      const cursor = Math.min(rows.length, viewport) - 1;
      const marker = {
        line: base + cursor + offset,
        isDisposed: false,
        dispose() {
          marker.isDisposed = true;
        },
      };
      markers.push(marker);
      return marker;
    },
  };
  return {
    term,
    write: (...lines: Array<string | [string, boolean]>) => {
      for (const l of lines) rows.push(typeof l === "string" ? [l, false] : l);
      onWrite?.();
    },
    rewrite: (y: number, text: string) => {
      rows[y] = [text, false];
      onWrite?.();
    },
    trim: (n: number) => {
      rows.splice(0, n);
      for (const m of markers) {
        m.line -= n;
        if (m.line < 0) m.isDisposed = true;
      }
    },
    /** A scrollback backfill: rows spliced in above everything, every marker
     *  shifted down, and a scroll — never a write — fired. */
    prepend: (...lines: string[]) => {
      rows.unshift(...lines.map((l): [string, boolean] => [l, false]));
      for (const m of markers) m.line += lines.length;
      onScroll?.();
    },
    setType: (t: "normal" | "alternate") => {
      type = t;
    },
  };
}

/** A manual scheduler: nothing runs until `flush`. */
function manual() {
  let queue: Array<() => void> = [];
  return {
    schedule: (run: () => void) => {
      queue.push(run);
      return () => {
        queue = queue.filter((r) => r !== run);
      };
    },
    flush: () => {
      for (let i = 0; i < 100 && queue.length > 0; i++) {
        const batch = queue;
        queue = [];
        for (const run of batch) run();
      }
    },
  };
}

let seq = 0;
const nextId = () =>
  `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}` as TerminalId;

describe("trackPrintedPorts", () => {
  it("indexes a URL already in the buffer before any write", () => {
    const f = fakeTerminal();
    f.write("ready at http://localhost:5173/");
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    stop();
  });

  it("indexes new output, coalescing a burst into one scan", () => {
    const f = fakeTerminal();
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    f.write("a");
    f.write("odu · http://127.0.0.1:18440/runs/x");
    f.write("b");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([18440]);
    stop();
  });

  it("reads a soft-wrapped URL whole", () => {
    const f = fakeTerminal();
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    f.write("see http://localhost:51", ["73/app", true]);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    stop();
  });

  it("catches a URL a program redraws INSIDE the viewport above the cursor", () => {
    // Claude Code re-renders its live region by moving the cursor up. A scan
    // that resumed from the last row it read would miss the rewritten row.
    const f = fakeTerminal(4);
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    f.write("1", "2", "working…", "prompt");
    clock.flush();
    f.rewrite(2, "└ odu · http://127.0.0.1:18440/runs/x");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([18440]);
    stop();
  });

  it("keeps its place across a scrollback trim", () => {
    const f = fakeTerminal(2);
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    f.write("a", "b", "c", "d");
    clock.flush();
    f.trim(2);
    f.write("http://localhost:3000/");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([3000]);
    stop();
  });

  it("reads a long scrollback in chunks without splitting a URL at the edge", () => {
    const f = fakeTerminal();
    const filler = Array.from(
      { length: SCAN_CHUNK_LINES - 1 },
      (_, i) => `line ${i}`,
    );
    // The URL's logical line starts on the last row of the first chunk and
    // wraps into the second — read in halves it would name port 51.
    f.write(...filler, "http://localhost:51", ["73/", true], "tail");
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    stop();
  });

  it("reads rows a scrollback BACKFILL splices in above everything", () => {
    // After a reload the buffer holds only recent rows; scrolling back prepends
    // older ones through a splice that fires a scroll, not a write.
    const f = fakeTerminal();
    f.write("recent", "prompt");
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([]);
    f.prepend("odu · http://127.0.0.1:18440/runs/x", "older output");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([18440]);
    stop();
  });

  it("keeps its place when output trims the buffer BETWEEN two chunks", () => {
    // A continuation that remembered a row NUMBER would start past rows that
    // moved up under it, and never read them.
    const f = fakeTerminal();
    const rows = Array.from({ length: SCAN_CHUNK_LINES * 2 }, (_, i) =>
      i === SCAN_CHUNK_LINES + 50 ? "http://localhost:4321/" : `line ${i}`,
    );
    f.write(...rows);
    let queue: Array<() => void> = [];
    const schedule = (run: () => void) => {
      queue.push(run);
      return () => {
        queue = queue.filter((r) => r !== run);
      };
    };
    const runOne = () => queue.shift()?.();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, schedule);
    runOne(); // first chunk only
    expect(printedPortsOf(id)).toEqual([]);
    f.trim(100);
    f.write("more");
    for (let i = 0; i < 20 && queue.length > 0; i++) runOne();
    expect(printedPortsOf(id)).toEqual([4321]);
    stop();
  });

  it("ignores the alternate buffer", () => {
    const f = fakeTerminal();
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    f.setType("alternate");
    f.write("http://localhost:9999/");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([]);
    stop();
  });

  it("forgets the terminal on dispose", () => {
    const f = fakeTerminal();
    f.write("http://localhost:5173/");
    const clock = manual();
    const id = nextId();
    const stop = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    stop();
    expect(printedPortsOf(id)).toEqual([]);
  });
});
