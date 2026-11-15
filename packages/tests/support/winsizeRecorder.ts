/**
 * The instrument for "what sizes is a program told?" (kolu#2362, kolu#2372).
 *
 * ONE FACT PER TERMINAL: the list of sizes the program inside it was told, in
 * order. A terminal's program is told a new size by SIGWINCH — which kaval
 * raises by resizing the PTY, and only ever for a size the PTY did not already
 * have (`ptyHost.ts`'s same-dims early return). So this list is not "how many
 * times something asked for a resize": it is the sizes the program actually
 * received, with identical repeats already swallowed below us.
 *
 * COALESCED SIGNALS ARE FINE, and that is why the record is a list of SIZES
 * rather than a count of signals: standard signals do not queue, so two
 * resizes a millisecond apart can reach the program as one SIGWINCH. The
 * program records the size it HAS when it is signalled, so a coalesced pair
 * shows up as one entry carrying the later size — never as a missed change
 * (the size it ends at is still different from the one it started at).
 *
 * READ BACK THROUGH THE DAEMON, never through the pane: `screen.text` is
 * kaval's own mirror of that PTY, so the record survives a page reload, is
 * unaffected by whether a tile is attached, and cannot be confused with what
 * the browser believes the terminal shows. The pane is the thing under
 * measurement; it must not also be the measuring instrument.
 *
 * The program is written as a file and run by absolute path
 * (`process.execPath`) for the reason `terminal_lockstep_steps.ts` gives: a
 * bare `node` resolves on every dev box and can fail only where node lives in
 * the dev shell alone, and whether the PTY's shell resolves `node` is a
 * different question from the one these scenarios ask.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pollFor } from "./poll.ts";
import { padiCall } from "./rpcWire.ts";

/** What every line the recorder prints starts with. Spelled here as one
 *  string and in {@link RECORDER_SOURCE} as a CONCATENATION, so only the
 *  program's own output can ever satisfy a wait for it — the shell echoes the
 *  command line it is given, and that line is a path, never these bytes
 *  (`dev/skills/e2e-testing/SKILL.md`). */
export const WINSIZE_MARK = "kolu-e2e-winsize";

/** One recorded line: the sequence number, and the size the program had when
 *  it was written. Sequence `0` is the size the program STARTED at — every
 *  later entry is a size it was told. */
const RECORD_LINE = new RegExp(`${WINSIZE_MARK} (\\d+) (\\d+)x(\\d+)`, "g");

/** How many lines of the daemon's mirror a read asks for. The program clears
 *  the screen when it starts and prints one short line per size, so its whole
 *  record is the tail; this is two orders of magnitude more room than any
 *  scenario here can fill, and `screen.text { tail }` reads a window rather
 *  than the whole buffer. */
const SCREEN_TAIL = 200;

/** How long the program gets to start and print its first line. Generous
 *  because it is paid once per recorder and covers a cold `node` start on a
 *  loaded CI box. */
const RECORDER_START_TIMEOUT = 20_000;

/**
 * The stand-in program. It does one thing: write down the size it has, at
 * start and on every SIGWINCH.
 *
 *  - It CLEARS the screen (and the scrollback) first, so the shell's echo of
 *    the command line is not part of the record and a mis-start is instantly
 *    legible in a failure's quoted screen.
 *  - It writes ONE short line per size — short so that no row can wrap at any
 *    grid these scenarios use, which keeps a reflow from splicing two entries
 *    into one row.
 *  - It numbers every line, so the record is read as an ORDERED list that can
 *    be checked for gaps rather than as "whatever is on screen".
 *  - Raw stdin, so a stray byte is never echoed into the record; Ctrl-C still
 *    exits.
 *
 * Written as `.cjs` so it runs the same whatever `package.json` sits above the
 * temp dir it lands in.
 */
const RECORDER_SOURCE = `"use strict";
var out = process.stdout;
var MARK = "kolu-e2e" + "-winsize";
var LIFETIME = 900000;
var seq = 0;

function say() {
  var cols = out.columns || 0;
  var rows = out.rows || 0;
  out.write(
    "\\r" + MARK + " " + ("000" + seq).slice(-3) + " " + cols + "x" + rows +
      "\\u001b[K\\r\\n"
  );
  seq++;
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", function (buf) {
  if (buf.indexOf(3) !== -1) process.exit(0);
});

out.write("\\u001b[2J\\u001b[3J\\u001b[H");
say();
out.on("resize", say);
setTimeout(function () {
  process.exit(0);
}, LIFETIME);
`;

/** The temp dir holding the program. Module scope is safe: cucumber runs one
 *  scenario's steps serially in one worker process (the same reasoning as
 *  `terminal_lockstep_steps.ts`). */
let recorderDir: string | null = null;

/** Write the program once per worker and answer its path. */
function recorderScript(): string {
  if (!recorderDir) {
    recorderDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-winsize-"));
    fs.writeFileSync(path.join(recorderDir, "recorder.cjs"), RECORDER_SOURCE);
  }
  return path.join(recorderDir, "recorder.cjs");
}

/** Drop the program's temp dir. Called from an `After` hook. */
export function removeRecorderScript(): void {
  if (!recorderDir) return;
  fs.rmSync(recorderDir, { recursive: true, force: true });
  recorderDir = null;
}

/** One size the program had, and when in its life it had it. */
export interface Winsize {
  /** `0` is the size it started at; `1..n` are the sizes it was TOLD. */
  seq: number;
  cols: number;
  rows: number;
}

/** The record as one line, for a failure message. */
export const formatWinsizes = (sizes: readonly Winsize[]): string =>
  sizes.length === 0
    ? "(nothing — the program never printed)"
    : sizes.map((s) => `#${s.seq} ${s.cols}x${s.rows}`).join(" → ");

/** The daemon's screen for one terminal — the mirror, not the pane. */
async function daemonScreen(terminalId: string): Promise<string> {
  const text = await padiCall("screen/text", {
    id: terminalId,
    tail: SCREEN_TAIL,
  });
  if (typeof text !== "string") {
    throw new Error(
      `padi answered screen.text for ${terminalId} with ${typeof text}, not text`,
    );
  }
  return text;
}

/**
 * Every size the program in `terminalId` has had, in order.
 *
 * Duplicate rows (a mirror reflow can leave the same line twice) collapse by
 * sequence number, and a GAP in the sequence throws rather than silently
 * shortening the list — a record read with a hole in it would under-report
 * exactly the thing these scenarios count.
 */
export async function readWinsizes(terminalId: string): Promise<Winsize[]> {
  const screen = await daemonScreen(terminalId);
  const bySeq = new Map<number, Winsize>();
  for (const match of screen.matchAll(RECORD_LINE)) {
    const seq = Number(match[1]);
    bySeq.set(seq, { seq, cols: Number(match[2]), rows: Number(match[3]) });
  }
  const sizes = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  sizes.forEach((size, index) => {
    if (size.seq !== index) {
      throw new Error(
        `the size record for terminal ${terminalId} has a hole in it at #${index}: ` +
          `${formatWinsizes(sizes)} — the screen no longer holds the whole record, ` +
          "so nothing can be counted from it",
      );
    }
  });
  return sizes;
}

/**
 * Start the recorder in `terminalId` and return the size it started at.
 *
 * The command goes in over the daemon's own `lifecycle.sendInput` rather than
 * through the keyboard: which pane holds focus is not part of any question
 * here, and a split's sub-pane has to be reachable too.
 */
export async function startRecorder(terminalId: string): Promise<Winsize> {
  const script = recorderScript();
  await padiCall("lifecycle/sendInput", {
    id: terminalId,
    data: `'${process.execPath}' '${script}'\r`,
  });

  // Prove the program is UP, from a line only its own first write can
  // produce. Without this, every environmental way a spawn can fail (no such
  // node, a shell still initializing) would surface later as "no new sizes
  // were recorded" — which is what a PASS looks like.
  let sizes: Winsize[];
  try {
    sizes = await pollFor({
      observe: () => readWinsizes(terminalId),
      isDone: (seen) => seen.length > 0,
      timeoutMs: RECORDER_START_TIMEOUT,
      intervalMs: 250,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `the size recorder never printed in terminal ${terminalId} within ${elapsedMs}ms`,
        ),
    });
  } catch (error) {
    throw new Error(
      `the size recorder never started in terminal ${terminalId} — this scenario ` +
        "cannot say anything about what its program was told. The daemon's screen " +
        `last showed:\n${await quoteDaemonScreen(terminalId)}`,
      { cause: error },
    );
  }
  const first = sizes[0];
  if (!first) throw new Error("unreachable: polled for a non-empty record");
  return first;
}

/** The daemon's screen tail, quoted for a failure message. */
export async function quoteDaemonScreen(terminalId: string): Promise<string> {
  try {
    const screen = await daemonScreen(terminalId);
    return screen.trimEnd().split("\n").slice(-12).join("\n");
  } catch (error) {
    return `(the daemon's screen could not be read: ${String(error)})`;
  }
}
