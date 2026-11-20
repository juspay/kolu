import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  MAX_TRACKED_PORTS,
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

function fakeTerminal(viewport = 3) {
  const rows: Array<[string, boolean]> = [];
  let onWrite: (() => void) | undefined;
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
    prepend: (...lines: string[]) => {
      rows.unshift(...lines.map((l): [string, boolean] => [l, false]));
      for (const m of markers) m.line += lines.length;
    },
    setType: (t: "normal" | "alternate") => {
      type = t;
    },
  };
}

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

function stepper() {
  let queue: Array<() => void> = [];
  return {
    schedule: (run: () => void) => {
      queue.push(run);
      return () => {
        queue = queue.filter((r) => r !== run);
      };
    },
    runOne: () => queue.shift()?.(),
    drain: () => {
      for (let i = 0; i < 50 && queue.length > 0; i++) queue.shift()?.();
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
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    tracker.dispose();
  });

  it("indexes new output, coalescing a burst into one scan", () => {
    const f = fakeTerminal();
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    f.write("a");
    f.write("odu · http://127.0.0.1:18440/runs/x");
    f.write("b");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([18440]);
    tracker.dispose();
  });

  it("reads a soft-wrapped URL whole", () => {
    const f = fakeTerminal();
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    f.write("see http://localhost:51", ["73/app", true]);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    tracker.dispose();
  });

  it("catches a URL a program redraws INSIDE the viewport above the cursor", () => {
    const f = fakeTerminal(4);
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    f.write("1", "2", "working…", "prompt");
    clock.flush();
    f.rewrite(2, "└ odu · http://127.0.0.1:18440/runs/x");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([18440]);
    tracker.dispose();
  });

  it("keeps its place across a scrollback trim", () => {
    const f = fakeTerminal(2);
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    f.write("a", "b", "c", "d");
    clock.flush();
    f.trim(2);
    f.write("http://localhost:3000/");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([3000]);
    tracker.dispose();
  });

  it("reads a long scrollback in chunks without splitting a URL at the edge", () => {
    const f = fakeTerminal();
    const filler = Array.from(
      { length: SCAN_CHUNK_LINES - 1 },
      (_, i) => `line ${i}`,
    );
    f.write(...filler, "http://localhost:51", ["73/", true], "tail");
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    tracker.dispose();
  });

  it("reads rows a scrollback BACKFILL splices in above everything", () => {
    const f = fakeTerminal();
    f.write("recent", "prompt");
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([]);
    f.prepend("odu · http://127.0.0.1:18440/runs/x", "older output");
    tracker.notePrepended();
    clock.flush();
    expect(printedPortsOf(id)).toEqual([18440]);
    tracker.dispose();
  });

  it("reads a backfill that lands DURING the first multi-chunk pass", () => {
    const f = fakeTerminal();
    f.write(
      ...Array.from({ length: SCAN_CHUNK_LINES * 2 }, (_, i) => `line ${i}`),
    );
    const q = stepper();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, q.schedule);
    q.runOne();
    f.prepend("http://localhost:18440/", "older");
    tracker.notePrepended();
    q.drain();
    expect(printedPortsOf(id)).toEqual([18440]);
    tracker.dispose();
  });

  it("reads a SECOND backfill that lands during the pass reading the first", () => {
    const f = fakeTerminal();
    f.write("recent", "prompt");
    const q = stepper();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, q.schedule);
    q.drain();
    f.prepend(
      ...Array.from({ length: SCAN_CHUNK_LINES * 2 }, (_, i) => `older ${i}`),
    );
    tracker.notePrepended();
    q.runOne();
    f.prepend("http://localhost:5173/", "oldest");
    tracker.notePrepended();
    q.drain();
    expect(printedPortsOf(id)).toEqual([5173]);
    tracker.dispose();
  });

  it("keeps its place when output trims the buffer BETWEEN two chunks", () => {
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
    const tracker = trackPrintedPorts(f.term, id, schedule);
    runOne();
    expect(printedPortsOf(id)).toEqual([]);
    f.trim(100);
    f.write("more");
    for (let i = 0; i < 20 && queue.length > 0; i++) runOne();
    expect(printedPortsOf(id)).toEqual([4321]);
    tracker.dispose();
  });

  it("ignores the alternate buffer", () => {
    const f = fakeTerminal();
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    f.setType("alternate");
    f.write("http://localhost:9999/");
    clock.flush();
    expect(printedPortsOf(id)).toEqual([]);
    tracker.dispose();
  });

  it("forgets the terminal on dispose", () => {
    const f = fakeTerminal();
    f.write("http://localhost:5173/");
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    expect(printedPortsOf(id)).toEqual([5173]);
    tracker.dispose();
    expect(printedPortsOf(id)).toEqual([]);
  });

  it("caps the index and evicts the oldest ports once it grows without bound", () => {
    const f = fakeTerminal();
    const total = MAX_TRACKED_PORTS + 100;
    for (let i = 0; i < total; i++) {
      f.write(`http://localhost:${20000 + i}/`);
    }
    const clock = manual();
    const id = nextId();
    const tracker = trackPrintedPorts(f.term, id, clock.schedule);
    clock.flush();
    const ports = printedPortsOf(id);
    expect(ports.length).toBe(MAX_TRACKED_PORTS);
    expect(ports).not.toContain(20000);
    expect(ports).not.toContain(20000 + 99);
    expect(ports).toContain(20000 + total - 1);
    expect(ports).toContain(20000 + 100);
    tracker.dispose();
  });
});
