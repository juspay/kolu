import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { waitForVisibleRows } from "../support/buffer.ts";
import {
  describeScreenMismatch,
  paneSelector,
  readTerminalScreens,
  type TerminalScreens,
} from "../support/daemonScreen.ts";
import { pollFor } from "../support/poll.ts";
import { padiCall } from "../support/rpcWire.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const MAIN_PANE = "[data-visible][data-font-size]:not([data-sub-terminal])";

const SPLIT_DIVIDER = '[data-testid="resize-handle"]';

const PAINTER_MARK = "kolu-e2e-painter";

const STATUS_LINE = new RegExp(
  `${PAINTER_MARK} grid (\\d+)x(\\d+) (\\d+)`,
  "g",
);

const PAINTER_START_TIMEOUT = 20_000;

const BURST_TIMEOUT = 10_000;

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

function appendRelative(text) {
  out.write("\\r" + text + csi("K") + "\\r\\n");
}

function statusLineAbsolute() {
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
  appendRelative(MARK + " log " + num(seq));
  statusLineAbsolute();
}

out.on("resize", function () {
  var s = csi(OWNED + "A") + "\\r" + csi("J");
  for (var i = 0; i < OWNED; i++) {
    s += MARK + " owned " + num(i) + csi("K") + "\\r\\n";
  }
  out.write(s);
  statusLineAbsolute();
  busyUntil = Date.now() + SETTLE_MS;
});

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", function (buf) {
  if (buf.indexOf(3) !== -1) process.exit(0);
  busyUntil = Date.now() + BURST_MS;
});

out.write(csi("2J") + csi("3J") + csi("H"));
appendRelative(MARK + " start");
setInterval(tick, TICK);
setTimeout(function () {
  process.exit(0);
}, LIFETIME);
`;

let painterDir: string | null = null;
let lastAgreedGrid: { cols: number; rows: number } | null = null;

After(() => {
  lastAgreedGrid = null;
  if (!painterDir) return;
  fs.rmSync(painterDir, { recursive: true, force: true });
  painterDir = null;
});

function paintedTerminalId(world: KoluWorld): string {
  const id = world.paintedTerminalId;
  assert.ok(
    id,
    'no painted terminal — run "a repainting program is running in the terminal" first',
  );
  return id;
}

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

interface Agreement {
  screens: TerminalScreens;
  program: { cols: number; rows: number; seq: number } | null;
  mismatch: string | null;
}

function agreed(a: Agreement): boolean {
  return (
    a.screens.paneHeldStillAcrossDaemonRead &&
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
  if (!last.screens.paneHeldStillAcrossDaemonRead) {
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

async function waitForAgreement(
  world: KoluWorld,
  id: string,
  extra: {
    isDone?: (a: Agreement) => boolean;
    onTimeout?: (last: Agreement | undefined, elapsedMs: number) => Error;
  } = {},
): Promise<void> {
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

    try {
      await waitForVisibleRows(this.page, `${PAINTER_MARK} grid`, {
        selector: paneSelector(id),
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
  await padiCall("lifecycle/sendInput", { id, data: "x" });
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
    await this.page.mouse.move(line.x, grabY - dy, { steps: 16 });
    await this.page.mouse.up();

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

Then(
  "the terminal fills its pane horizontally, with its last row on the pane's floor",
  async function (this: KoluWorld) {
    const id = paintedTerminalId(this);
    const box = await this.page.evaluate((sel) => {
      const pane = document.querySelector(sel);
      const term = pane?.querySelector(".xterm");
      const viewport = term?.querySelector(".xterm-viewport");
      const screen = term?.querySelector(".xterm-screen");
      if (!pane || !term || !viewport || !screen) return null;
      const p = pane.getBoundingClientRect();
      const t = term.getBoundingClientRect();
      const v = viewport.getBoundingClientRect();
      const s = screen.getBoundingClientRect();
      return {
        paneLeft: p.left,
        paneRight: p.right,
        paneTop: p.top,
        paneBottom: p.bottom,
        termLeft: t.left,
        termRight: t.right,
        viewportRight: v.right,
        screenBottom: s.bottom,
        screenTop: s.top,
      };
    }, paneSelector(id));
    assert.ok(box, "the pane has no .xterm to measure");
    const near = (a: number, b: number) => Math.abs(a - b) < 1;
    assert.ok(
      near(box.termLeft, box.paneLeft) && near(box.termRight, box.paneRight),
      `the terminal is ${box.termRight - box.termLeft}px wide inside a ${box.paneRight - box.paneLeft}px pane — ` +
        "it must span the pane's full width, or the columns the grid reserves for the scrollbar end up outside it",
    );
    assert.ok(
      near(box.viewportRight, box.paneRight),
      `the scrollbar's right edge is ${box.paneRight - box.viewportRight}px inside the pane's — it must be at the pane's edge`,
    );
    assert.ok(
      near(box.screenBottom, box.paneBottom),
      `the last row's bottom edge is ${box.paneBottom - box.screenBottom}px above the pane's floor — the terminal must sit on it`,
    );
    assert.ok(
      box.screenTop >= box.paneTop - 1,
      `the terminal starts ${box.paneTop - box.screenTop}px above the pane — the leftover strip belongs at the top, not off it`,
    );
  },
);
