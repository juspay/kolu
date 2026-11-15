/**
 * Steps for the promise in `features/terminal-lockstep.feature`: what the pane
 * shows is what the program drew.
 *
 * The arrangement is a real program in the real PTY, because the defect this
 * guards lives in the ORDER of two things that both cross the wire — the bytes
 * a program writes and the resize it is told about. A mock cannot have an
 * order between them.
 *
 * The program (`PAINTER_SOURCE`) is written as a file and run by absolute path
 * (`process.execPath`, the node already running this suite) rather than typed
 * as a one-liner: a bare `node` resolves on every dev box and can fail only
 * where node lives in the dev shell alone, and whether the PTY's shell
 * resolves `node` is a different question from the one this scenario asks
 * (`dev/skills/e2e-testing/SKILL.md`).
 */

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import {
  describeScreenMismatch,
  paneSelector,
  readTerminalScreens,
  type TerminalScreens,
} from "../support/daemonScreen.ts";
import { pollFor } from "../support/poll.ts";
import { padiCall } from "../support/rpcWire.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** The visible MAIN pane of a tile — the one `terminalRun` types into, and
 *  the one whose box a split, a divider drag and a font zoom all move. */
const MAIN_PANE = "[data-visible][data-font-size]:not([data-sub-terminal])";

/** The split divider (`TerminalContent.tsx`). */
const SPLIT_DIVIDER = '[data-testid="resize-handle"]';

/** What every line the program draws starts with. Spelled here as one string
 *  and spelled in {@link PAINTER_SOURCE} as a CONCATENATION, so only the
 *  program's own output can ever satisfy a wait for it — and the program is
 *  run from a file, so the shell's echo is a path and never these bytes. */
const PAINTER_MARK = "kolu-e2e-painter";

/** The program's status line: the grid IT believes it has — the winsize kaval
 *  set on the PTY — and the tick that wrote it. The tick is what makes the
 *  reading unambiguous: older status lines are still on screen above the
 *  newest one, and a resize can leave one of them BELOW it, so "the program's
 *  current belief" is the highest tick, never the lowest line. */
const STATUS_LINE = new RegExp(
  `${PAINTER_MARK} grid (\\d+)x(\\d+) (\\d+)`,
  "g",
);

/** How long the program gets to start and draw its first lines. Only the
 *  spawn — the screen comparisons have their own budget. */
const PAINTER_START_TIMEOUT = 20_000;

/** How long a burst step waits for the program's output to actually move. */
const BURST_TIMEOUT = 10_000;

/**
 * The stand-in for the program that exposed the defect — an ordinary
 * full-screen shape: a scrolling log, a fixed status line, a repaint when the
 * window changes.
 *
 *  - It APPENDS lines, the way a program that prints output does, so the
 *    screen is a window onto a history that is never written twice.
 *  - It writes its status line with ABSOLUTE addressing, at a row derived from
 *    the size it was told it has, with the cursor saved and restored around it.
 *    This is the carrier: a pane that is a different size than the program was
 *    told puts that write on a DIFFERENT line of history, and no later write
 *    ever goes back to repair it.
 *  - On `SIGWINCH` it repaints with RELATIVE moves — up over the lines it
 *    believes it drew, erase below, draw them again — so the repair lands
 *    wherever that terminal's cursor happens to be rather than at a row
 *    everyone agrees on.
 *  - It writes only in BURSTS: a byte on stdin starts one, and the resize ends
 *    it a moment later. That is what makes the comparison possible at all —
 *    the bytes are in flight exactly across the box change, and the screen
 *    then stops so both copies of it can be read and compared.
 *
 * Written as `.cjs` so it runs the same whatever `package.json` sits above
 * the temp dir it lands in. Lines are kept short so no row ever wraps — the
 * daemon serializes one buffer row per line while the pane's reader rejoins a
 * wrapped row with its continuation, and that difference is about the readers,
 * not about the screens.
 */
const PAINTER_SOURCE = `"use strict";
var out = process.stdout;
var MARK = "kolu-e2e" + "-painter";
var TICK = 120;
var BURST_MS = 15000;
var SETTLE_MS = 150;
var START_MS = 1500;
var OWNED = 4;
var STATUS_UP = 5;
var LIFETIME = 180000;

var seq = 0;
var busyUntil = Date.now() + START_MS;

function csi(body) { return "\\u001b[" + body; }
function num(n) { return ("0000" + n).slice(-4); }

// One line of history. The cursor ends at column 1 of the line below — the
// append point every other write here is relative to.
function append(text) {
  out.write("\\r" + text + csi("K") + "\\r\\n");
}

// The fixed status line, addressed ABSOLUTELY from the size this program was
// told it has, cursor saved and restored around it so the append point is
// untouched.
function status() {
  var cols = out.columns || 80;
  var rows = out.rows || 24;
  var row = Math.max(1, rows - STATUS_UP);
  out.write(
    "\\u001b7" + csi(row + ";1H") +
      MARK + " grid " + cols + "x" + rows + " " + num(seq) +
      csi("K") + "\\u001b8"
  );
}

function tick() {
  if (Date.now() > busyUntil) return;
  seq++;
  append(MARK + " log " + num(seq));
  status();
}

// Told the window changed: step back over the lines it believes it drew,
// erase from there down, draw them again — all relative. Then stop writing
// almost at once, so whatever each side ended up with stays on screen.
out.on("resize", function () {
  var s = csi(OWNED + "A") + "\\r" + csi("J");
  for (var i = 0; i < OWNED; i++) {
    s += MARK + " owned " + num(i) + csi("K") + "\\r\\n";
  }
  out.write(s);
  status();
  busyUntil = Date.now() + SETTLE_MS;
});

// Raw stdin: one byte starts a burst, unechoed, so a burst can be asked for
// without putting anything on the screen.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", function (buf) {
  if (buf.indexOf(3) !== -1) process.exit(0);
  busyUntil = Date.now() + BURST_MS;
});

out.write(csi("2J") + csi("3J") + csi("H"));
append(MARK + " start");
setInterval(tick, TICK);
setTimeout(function () {
  process.exit(0);
}, LIFETIME);
`;

/** The temp dir holding the running program, and the grid the two screens
 *  last agreed at. Module scope is safe: cucumber runs one scenario's steps
 *  serially in one worker process (the same reasoning as
 *  `preferences_steps.ts`). */
let painterDir: string | null = null;
let lastAgreedGrid: { cols: number; rows: number } | null = null;

After(() => {
  lastAgreedGrid = null;
  if (!painterDir) return;
  fs.rmSync(painterDir, { recursive: true, force: true });
  painterDir = null;
});

/** The terminal whose two screens this scenario compares. */
function paintedTerminalId(world: KoluWorld): string {
  const id = world.paintedTerminalId;
  assert.ok(
    id,
    'no painted terminal — run "a repainting program is running in the terminal" first',
  );
  return id;
}

/** What the program says its grid is, as of its most recent status line. */
function programGrid(
  screen: string,
): { cols: number; rows: number; seq: number } | null {
  let latest: { cols: number; rows: number; seq: number } | null = null;
  for (const match of screen.matchAll(STATUS_LINE)) {
    const seen = {
      cols: Number(match[1]),
      rows: Number(match[2]),
      seq: Number(match[3]),
    };
    if (!latest || seen.seq > latest.seq) latest = seen;
  }
  return latest;
}

/** One sample of the whole claim: both screens, and the grid the program
 *  believes it is drawing for. */
interface Agreement {
  screens: TerminalScreens;
  program: { cols: number; rows: number; seq: number } | null;
  mismatch: string | null;
}

/** Is this sample the settled, agreeing state?
 *
 *  Three things, and all three are the same claim from different sides: the
 *  pane held still across the daemon's read (so the comparison was taken at
 *  one instant), the two screens are the same text, and the pane's xterm is at
 *  the grid the program is drawing for. The third is what stops this from
 *  passing on the gap: before a box change has reached the daemon, the two
 *  screens still agree — at the OLD size — and only the grid says so. */
function agreed(a: Agreement): boolean {
  return (
    a.screens.stable &&
    a.mismatch === null &&
    !!a.program &&
    a.program.cols === a.screens.grid.cols &&
    a.program.rows === a.screens.grid.rows
  );
}

function agreementFailure(
  last: Agreement | undefined,
  elapsedMs: number,
  id: string,
): Error {
  if (!last) {
    return new Error(
      `neither screen could be read for terminal ${id} within ${elapsedMs}ms`,
    );
  }
  if (last.mismatch) {
    return new Error(
      `after ${elapsedMs}ms the pane is still showing something the program never drew.\n${last.mismatch}`,
    );
  }
  if (!last.screens.stable) {
    return new Error(
      `after ${elapsedMs}ms the pane never held still long enough to be compared — the program is still writing`,
    );
  }
  const drawn = last.program
    ? `${last.program.cols}x${last.program.rows}`
    : "nothing — the program's status line is not on screen";
  return new Error(
    `after ${elapsedMs}ms the pane is ${last.screens.grid.cols}x${last.screens.grid.rows} ` +
      `while the program is drawing for ${drawn}: the pane took a size the program was never told about`,
  );
}

/** Poll until the two screens agree, then remember the grid they agreed at. */
async function waitForAgreement(
  world: KoluWorld,
  id: string,
  extra: {
    isDone?: (a: Agreement) => boolean;
    onTimeout?: (last: Agreement | undefined, elapsedMs: number) => Error;
  } = {},
): Promise<void> {
  // POLLED, never slept: how long a box change takes to reach the daemon and
  // come back is a property of the machine, and the loop ends the moment the
  // two screens agree.
  const settled = await pollFor({
    observe: async (): Promise<Agreement> => {
      const screens = await readTerminalScreens(world.page, id);
      return {
        screens,
        program: programGrid(screens.pane),
        mismatch: describeScreenMismatch(screens),
      };
    },
    isDone: (a) => agreed(a) && (extra.isDone?.(a) ?? true),
    timeoutMs: POLL_TIMEOUT,
    intervalMs: 250,
    onTimeout: (last, elapsedMs) =>
      extra.onTimeout?.(last, elapsedMs) ??
      agreementFailure(last, elapsedMs, id),
  });
  lastAgreedGrid = settled.screens.grid;
}

/** The main pane's pixel box, so a step that moves it can prove it moved. */
function paneBox(
  world: KoluWorld,
  terminalId: string,
): Promise<{ width: number; height: number } | null> {
  return world.page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }, paneSelector(terminalId));
}

Given(
  "a repainting program is running in the terminal",
  async function (this: KoluWorld) {
    const id = await this.page.evaluate(
      (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
      MAIN_PANE,
    );
    assert.ok(id, "no visible main pane to run the program in");
    this.paintedTerminalId = id;
    lastAgreedGrid = null;

    painterDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-painter-"));
    const script = path.join(painterDir, "painter.cjs");
    fs.writeFileSync(script, PAINTER_SOURCE);

    await this.terminalRun(`'${process.execPath}' '${script}'`);

    // Prove the program is UP, from a line only its own first tick can
    // produce. Without this every environmental way a spawn can fail (no such
    // node, a shell still initializing) would surface later as "the two
    // screens disagree" and read as the defect this scenario is about.
    try {
      await waitForBufferContains(this.page, `${PAINTER_MARK} grid`, {
        selector: paneSelector(id),
        viewport: true,
        timeout: PAINTER_START_TIMEOUT,
      });
    } catch (error) {
      const shown = await this.page.evaluate(
        (sel) => window.__readXtermBuffer?.(sel, 0) ?? "",
        paneSelector(id),
      );
      throw new Error(
        `the repainting program never drew within ${PAINTER_START_TIMEOUT}ms — ` +
          "this scenario cannot say anything about what the pane shows. The terminal last showed:\n" +
          shown.trimEnd().split("\n").slice(-12).join("\n"),
        { cause: error },
      );
    }
  },
);

When("the program begins a burst of output", async function (this: KoluWorld) {
  const id = paintedTerminalId(this);
  const before = await readTerminalScreens(this.page, id);
  // One byte, into a program that put its terminal in raw mode: it starts
  // writing and nothing is echoed, so the burst adds no bytes of its own to
  // the screen being compared.
  await padiCall("lifecycle/sendInput", { id, data: "x" });
  // Prove it IS writing. A burst that never started would make the next box
  // change happen over a quiet terminal, where nothing can come apart — the
  // scenario would pass without ever asking its question.
  await pollFor({
    observe: () => readTerminalScreens(this.page, id),
    isDone: (now) => now.pane !== before.pane,
    timeoutMs: BURST_TIMEOUT,
    intervalMs: 100,
    onTimeout: (_last, elapsedMs) =>
      new Error(
        `the program printed nothing in ${elapsedMs}ms after being nudged — it is not writing, so the box change that follows would prove nothing`,
      ),
  });
});

When(
  "I drag the split divider up by {int} pixels",
  async function (this: KoluWorld, dy: number) {
    const id = paintedTerminalId(this);
    const before = await paneBox(this, id);
    assert.ok(before, "no main pane to resize");

    // Hand-driven rather than `dragFromCenter`: the divider is a zero-height
    // line whose hit zone is an 8px `::before` straddling it
    // (TerminalContent.tsx), and Playwright's locator helpers gate on
    // visibility — a zero-height box is never "visible", and its own centre
    // sits on the line rather than in the zone. Press 2px above it instead.
    const line = await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y };
    }, SPLIT_DIVIDER);
    assert.ok(line, "no split divider on screen — open a split first");

    const grabY = line.y - 2;
    await this.page.mouse.move(line.x, grabY);
    await this.page.mouse.down();
    // Stepped so the pointermove listeners see real frames, the way a user's
    // drag does.
    await this.page.mouse.move(line.x, grabY - dy, { steps: 16 });
    await this.page.mouse.up();

    // An arrangement that moved nothing would make every assertion after it
    // vacuous, so prove the pane's box actually changed.
    await pollFor({
      observe: () => paneBox(this, id),
      isDone: (box) => !!box && Math.abs(box.height - before.height) > 8,
      timeoutMs: POLL_TIMEOUT,
      intervalMs: 100,
      onTimeout: (last) =>
        new Error(
          `dragging the split divider up by ${dy}px moved nothing: the main pane is still ` +
            `${Math.round(last?.height ?? -1)}px tall (was ${Math.round(before.height)}px)`,
        ),
    });
  },
);

Then(
  "the terminal shows exactly what the program drew",
  async function (this: KoluWorld) {
    await waitForAgreement(this, paintedTerminalId(this));
  },
);

Then(
  "the terminal takes its new size and shows exactly what the program drew",
  async function (this: KoluWorld) {
    const id = paintedTerminalId(this);
    const previous = lastAgreedGrid;
    assert.ok(
      previous,
      'no earlier agreement to compare against — run "the terminal shows exactly what the program drew" first',
    );
    // The box moved, so the grid MUST move — and only then is the comparison
    // worth anything. Without this the step would pass on the gap: for the
    // first quarter-second after a box change the pane is still at its old
    // grid, still agreeing with the daemon about the old screen, and a
    // comparison taken there would pass just as happily on a build where the
    // new size never arrives at all.
    await waitForAgreement(this, id, {
      isDone: (a) =>
        a.screens.grid.cols !== previous.cols ||
        a.screens.grid.rows !== previous.rows,
      onTimeout: (last, elapsedMs) => {
        if (last && agreed(last)) {
          return new Error(
            `after ${elapsedMs}ms the terminal is still ${last.screens.grid.cols}x${last.screens.grid.rows} — ` +
              "the same grid as before the box moved, so the new size never came back from the daemon",
          );
        }
        return agreementFailure(last, elapsedMs, id);
      },
    });
  },
);
