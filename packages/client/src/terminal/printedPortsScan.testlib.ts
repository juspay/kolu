/** THE PRINTED-PORT SCANNER, DRIVEN BY HAND — a terminal buffer small enough
 *  to state in a test, and the queue its passes run on.
 *
 *  `trackPrintedPorts` is the PRODUCTION writer of the printed-port index, so
 *  a suite that needs that index populated drives it rather than writing the
 *  store behind its back. What such a suite has to supply is the xterm slice
 *  the scanner reads and the scheduler it asks for passes on; both live here
 *  so the suites that need them cannot drift apart.
 *
 *  A pass is its own task in the app and the tracker only ever has ONE in
 *  flight, so a scheduler that ran a pass inside the call that asked for it
 *  would leave the tracker holding a canceller for a pass already finished —
 *  and never ask for another. {@link runScans} is the drain instead. */

import type { TerminalId } from "kolu-common/surface";
import { flush } from "solid-js";
import {
  type PrintedPortsTracker,
  type ScannableTerminal,
  trackPrintedPorts,
} from "./printedPorts";

const passes: Array<() => void> = [];
const trackers: PrintedPortsTracker[] = [];

/** Run every scan pass asked for so far — and the ones those passes ask for —
 *  then the Solid flush that lands what they wrote. */
export function runScans(): void {
  for (let turn = 0; turn < 100 && passes.length > 0; turn++) {
    for (const run of passes.splice(0, passes.length)) run();
  }
  flush();
}

/** Forget every terminal {@link printingTerminal} opened. The index is module
 *  state for the page's lifetime, so a suite drops its own entries itself. */
export function stopScans(): void {
  for (const tracker of trackers.splice(0, trackers.length)) tracker.dispose();
  passes.length = 0;
  flush();
}

/** A terminal that prints URLs. Its buffer is the smallest the scanner reads:
 *  rows unwrapped, the cursor on the last one and nothing scrolled off, so
 *  every pass reads the whole of it. Answers the act of printing ONE loopback
 *  URL — visible to the index once {@link runScans} has run. */
export function printingTerminal(id: TerminalId): (port: number) => void {
  const rows: string[] = [];
  let onWrite: (() => void) | undefined;
  const term: ScannableTerminal = {
    buffer: {
      active: {
        type: "normal",
        get length() {
          return rows.length;
        },
        get baseY() {
          return 0;
        },
        get cursorY() {
          return Math.max(0, rows.length - 1);
        },
        getLine: (y) => {
          const row = rows[y];
          return row === undefined
            ? undefined
            : { isWrapped: false, translateToString: () => row };
        },
      },
    },
    onWriteParsed: (listener) => {
      onWrite = listener;
      return {
        dispose: () => {
          onWrite = undefined;
        },
      };
    },
    registerMarker: (offset = 0) => {
      const marker = {
        line: Math.max(0, rows.length - 1) + offset,
        isDisposed: false,
        dispose: () => {
          marker.isDisposed = true;
        },
      };
      return marker;
    },
  };
  trackers.push(
    trackPrintedPorts(term, id, (run) => {
      passes.push(run);
      return () => {
        const at = passes.indexOf(run);
        if (at >= 0) passes.splice(at, 1);
      };
    }),
  );
  return (port) => {
    rows.push(`  ➜  Local:   http://localhost:${port}/`);
    onWrite?.();
  };
}
