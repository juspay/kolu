/**
 * Steps for `features/mount-size-stability.feature`: what sizes is a program
 * told when nothing about its box changed?
 *
 * The instrument is `support/winsizeRecorder.ts` — a stand-in program in the
 * real PTY that writes down the size it has at start and on every SIGWINCH,
 * read back through the DAEMON's mirror so the measurement does not depend on
 * the pane it is measuring. These steps add the two things a measurement
 * needs beyond the record: a baseline taken only once every program has gone
 * QUIET, and a negative hold long enough that "no new size" is a fact about a
 * round trip rather than about how soon the assertion ran.
 *
 * A note on what a PASS means here. kaval refuses a resize to the size a PTY
 * already has (`ptyHost.ts`'s same-dims early return), so a repeated identical
 * size never reaches the program and never appears in the record. The record
 * therefore counts REAL size changes — every entry past the baseline is a box
 * that genuinely differed at the moment it was stated.
 */

import * as assert from "node:assert";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { paneSelector } from "../support/daemonScreen.ts";
import {
  installResizeWireProbe,
  quoteResizeWire,
} from "../support/resizeWire.ts";
import { pollFor } from "../support/poll.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  formatWinsizes,
  readWinsizes,
  removeRecorderScript,
  startRecorder,
  type Winsize,
} from "../support/winsizeRecorder.ts";
import {
  CANVAS_TILE_SELECTOR,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

/**
 * How long a program must be watched before "it was told no new size" means
 * anything.
 *
 * A pane no longer resizes itself when its box moves: it STATES the grid its
 * box can hold, and the size reaches the program through a round trip. The
 * spans on that trip:
 *
 *   · 250 ms — the publish settle (`GRID_SETTLE_MS`, `publishGrid.ts`),
 *     re-armed by every further change, so the last measurement of a moving
 *     box is published a quarter second after it stops moving;
 *   · 600 ms — kaval's resize window (`RESIZE_WINDOW_MS`, `ptyHost.ts`), the
 *     span in which the consequences of a resize are still in flight;
 *   · a round trip — browser → kolu-server → padi → kaval → the PTY, then the
 *     program's own write into kaval's mirror and this process's read of it.
 *
 * 3 s is that 850 ms plus better than two seconds of slack, which is what a
 * CI box carrying up to eight browser worlds needs (the harness's own
 * `GRID_ROUND_TRIP_MS` is 3 s for the same shape of claim). A hold is paid in
 * full on every PASSING run, so it is sized to be believable rather than
 * comfortable.
 */
const QUIET_MS = 3_000;

/** How long the arrange may take to stop moving before a baseline is taken. */
const SETTLE_BUDGET_MS = POLL_TIMEOUT;

/** How often the record is re-read while holding. Fast enough that a failure
 *  can say WHEN the new size landed, cheap enough to run for seconds. */
const SAMPLE_MS = 250;

/** The visible MAIN pane of a tile — the one `terminalRun` types into. */
const MAIN_PANE = "[data-visible][data-font-size]:not([data-sub-terminal])";

/** Every mounted pane: the inner terminal container carries both the id and
 *  `data-font-size` (`support/buffer.ts`). */
const ANY_PANE = "[data-terminal-id][data-font-size]";

/** One terminal under measurement. */
interface Recorded {
  /** How a failure names it. */
  label: string;
  /** The record as it stood when the scenario last took a baseline. */
  baseline: Winsize[];
}

/** The terminals this scenario is recording, in the order they were started.
 *  Module scope is safe: cucumber runs one scenario's steps serially in one
 *  worker process (the same reasoning as `terminal_lockstep_steps.ts`). */
const recorded = new Map<string, Recorded>();

After(() => {
  recorded.clear();
  removeRecorderScript();
});

/** Every pane on screen, main panes first, with the label a failure uses. */
async function panesOnScreen(
  world: KoluWorld,
): Promise<Array<{ id: string; label: string }>> {
  const panes = await world.page.evaluate((sel) => {
    const seen: Array<{ id: string; sub: boolean }> = [];
    for (const node of document.querySelectorAll(sel)) {
      const id = node.getAttribute("data-terminal-id");
      if (!id || seen.some((p) => p.id === id)) continue;
      seen.push({ id, sub: node.hasAttribute("data-sub-terminal") });
    }
    return seen;
  }, ANY_PANE);
  return panes
    .sort((a, b) => Number(a.sub) - Number(b.sub))
    .map((pane, index) => ({
      id: pane.id,
      label: pane.sub ? `sub-pane ${pane.id}` : `pane ${index + 1} ${pane.id}`,
    }));
}

/** The record for every terminal under measurement, read once. */
async function readAll(): Promise<Map<string, Winsize[]>> {
  const now = new Map<string, Winsize[]>();
  for (const id of recorded.keys()) now.set(id, await readWinsizes(id));
  return now;
}

/** The ids under measurement — what the wire probe is filtered against. */
const recordedIds = (): string[] => [...recorded.keys()];

/** One size a program was told during a watch, and how far into it. */
interface Told {
  id: string;
  label: string;
  size: Winsize;
  atMs: number;
}

/** Watch the named programs for the whole of `QUIET_MS` and answer every size
 *  they were told, in the order they were told.
 *
 *  The window is watched to its END rather than abandoned at the first size,
 *  because this phase is a MEASUREMENT: a mount that states the wrong box and
 *  then corrects itself tells its program two sizes, and "it was told 19 then
 *  27 then 19 again" is the finding. Stopping at the first would report half
 *  a bounce.
 *
 *  Every negative in this feature goes through here: a size that arrives at
 *  the far end of a round trip is not refuted by a read taken before it could
 *  have come back. */
async function watchQuiet(only?: readonly string[]): Promise<Told[]> {
  const watched = only ?? [...recorded.keys()];
  const started = Date.now();
  const seen = new Map(
    watched.map((id) => [id, (recorded.get(id)?.baseline ?? []).length]),
  );
  const told: Told[] = [];
  for (;;) {
    const now = await readAll();
    const atMs = Date.now() - started;
    for (const id of watched) {
      const sizes = now.get(id) ?? [];
      const from = seen.get(id) ?? 0;
      for (const size of sizes.slice(from)) {
        told.push({
          id,
          label: recorded.get(id)?.label ?? id,
          size,
          atMs,
        });
      }
      seen.set(id, sizes.length);
    }
    if (atMs >= QUIET_MS) return told;
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
  }
}

/** What a watch SAW, one line per size, for a report or a failure. */
const describeTold = (told: readonly Told[]): string =>
  told
    .map(
      (t) =>
        `    ${t.label} was told ${t.size.cols}x${t.size.rows} (#${t.size.seq}, ${t.atMs}ms into the window)`,
    )
    .join("\n");

/** Move every watched program's baseline up to what it has been told now, so
 *  the NEXT watch reports only its own sizes. */
async function rebaseline(): Promise<void> {
  for (const [id, sizes] of await readAll()) {
    const entry = recorded.get(id);
    if (entry) entry.baseline = sizes;
  }
}

/** Watch, and fail if anything was told — the shape every negative step takes. */
async function holdQuiet(
  world: KoluWorld,
  what: string,
  only?: readonly string[],
): Promise<void> {
  const told = await watchQuiet(only);
  if (told.length === 0) return;
  throw new Error(
    `${what}: a program was told a new size with nothing about its box changed.\n` +
      `${describeTold(told)}\n` +
      `${await quoteResizeWire(world.page, recordedIds())}`,
  );
}

// ── Arrange ──

Given(
  "a size recorder is running in every pane on screen",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    await installResizeWireProbe(this.page);
    const panes = await panesOnScreen(this);
    assert.ok(panes.length > 0, "no mounted pane to record sizes in");
    for (const pane of panes) {
      const start = await startRecorder(pane.id);
      recorded.set(pane.id, { label: pane.label, baseline: [start] });
    }
    // The divider-drag step (`terminal_lockstep_steps.ts`) addresses the
    // terminal a stand-in program is drawing in; the recorder IS one, so
    // naming it here lets that step be reused rather than re-written.
    const main = await this.page.evaluate(
      (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
      MAIN_PANE,
    );
    if (main) this.paintedTerminalId = main;
  },
);

Given(
  "every recorded program has settled",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    // The baseline is taken only once nothing has moved for a full quiet
    // window. Without this the arrange's own resize — a split opening, a
    // divider landing — could still be in flight, and the first reload would
    // be blamed for it.
    const deadline = Date.now() + SETTLE_BUDGET_MS;
    let stableSince = Date.now();
    let last = await readAll();
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS));
      const now = await readAll();
      const moved = recordedIds().some(
        (id) => (now.get(id)?.length ?? 0) !== (last.get(id)?.length ?? 0),
      );
      if (moved) stableSince = Date.now();
      last = now;
      if (Date.now() - stableSince >= QUIET_MS) break;
      if (Date.now() > deadline) {
        throw new Error(
          `the terminals never stopped being resized within ${SETTLE_BUDGET_MS}ms, ` +
            "so there is no settled state to measure from:\n" +
            [...now]
              .map(
                ([id, sizes]) =>
                  `  ${recorded.get(id)?.label ?? id}: ${formatWinsizes(sizes)}`,
              )
              .join("\n"),
        );
      }
    }
    await rebaseline();
  },
);

// ── Act ──

When(
  "I reload the page {int} times",
  { timeout: 900_000 },
  async function (this: KoluWorld, mounts: number) {
    // EVERY mount is watched and reported, and the verdict is taken at the
    // end. A loop that threw at the first bad mount would answer "mount 2"
    // and leave the question this phase exists to answer — does it happen on
    // every mount, or once in dozens? — unanswered for mounts 3..15. The
    // baseline moves up after each mount so each line is that mount's own
    // story.
    const perMount: string[] = [];
    let mountsThatTold = 0;
    // The wire from the FIRST mount that told a size. Each reload is a new
    // document, so the probe's stash is that mount's own and no other's — and
    // the first offender is the decisive one: it is the only mount whose
    // writes can still be acting on the state the arrange left behind.
    let firstWire: string | null = null;
    for (let mount = 1; mount <= mounts; mount++) {
      await this.page.reload();
      await this.waitForReady();
      const told = await watchQuiet();
      if (told.length > 0) {
        mountsThatTold++;
        perMount.push(`  mount ${mount}:\n${describeTold(told)}`);
        if (!firstWire) {
          firstWire = `  the wire at mount ${mount}:\n${await quoteResizeWire(
            this.page,
            recordedIds(),
          )}`;
        }
      } else {
        perMount.push(`  mount ${mount}: nothing`);
      }
      await rebaseline();
    }
    const report = `[mount-size] ${mounts} mounts\n${perMount.join("\n")}${
      firstWire ? `\n${firstWire}` : ""
    }`;
    console.log(report);
    if (mountsThatTold > 0) {
      throw new Error(
        `${mountsThatTold} of ${mounts} mounts told a program a new size with nothing ` +
          `about its box changed.\n${report}`,
      );
    }
  },
);

When(
  "I create another terminal and start a size recorder in it",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const before = new Set(await this.terminalIds());
    // Created over the daemon's own `lifecycle.create` rather than through the
    // keyboard: the recorder has to be started as early as possible, and the
    // UI path's own waits (tile visible, keyboard landed) are all AFTER the
    // mount whose resizes this scenario is counting. The tile still mounts
    // from the record exactly as a keyboard-created one does.
    const created = await padiCall("lifecycle/create", {
      placement: { kind: "toplevel" },
    });
    const id =
      created && typeof created === "object" && "id" in created
        ? String(created.id)
        : null;
    assert.ok(
      id,
      `lifecycle.create answered no id: ${JSON.stringify(created)}`,
    );
    assert.ok(!before.has(id), `lifecycle.create answered a known id: ${id}`);
    const start = await startRecorder(id);
    recorded.set(id, { label: `the new terminal ${id}`, baseline: [start] });
    this.createdTerminalIds.push(id);
    // The tile must actually mount, or the scenario would be asking its
    // question of a terminal nobody ever showed.
    await this.page
      .locator(`${paneSelector(id)}`)
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

When(
  "I wait out the settle window",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
  },
);
When(
  "I narrow every recorded tile by {int} pixels",
  { timeout: 120_000 },
  async function (this: KoluWorld, px: number) {
    // A tiled pane's box is its tile's own rect — the canvas's pan and zoom
    // ride a CSS transform, which is why magnifying the canvas deliberately
    // reflows nothing. So the way to move a tiled pane's box is to move the
    // tile, and the product's own door for that is the terminal's
    // `canvasLayout` (what a drag-resize persists, and what the record
    // carries). Narrowing also takes the layout OFF the default tile size, so
    // a mount that falls back to that default before the record arrives has
    // somewhere visible to fall.
    const tiles = await this.page.evaluate(
      ({ sel, ids }) => {
        const found: Array<{
          id: string;
          x: number;
          y: number;
          w: number;
          h: number;
        }> = [];
        for (const node of document.querySelectorAll(sel)) {
          const id = node.getAttribute("data-terminal-id");
          if (!id || !ids.includes(id) || !(node instanceof HTMLElement))
            continue;
          found.push({
            id,
            x: Number.parseFloat(node.style.left),
            y: Number.parseFloat(node.style.top),
            w: Number.parseFloat(node.style.width),
            h: Number.parseFloat(node.style.height),
          });
        }
        return found;
      },
      { sel: CANVAS_TILE_SELECTOR, ids: recordedIds() },
    );
    assert.ok(tiles.length > 0, "no recorded terminal owns a canvas tile");
    for (const tile of tiles) {
      assert.ok(
        Number.isFinite(tile.w) && tile.w > px,
        `canvas tile ${tile.id} has no usable width to narrow (${tile.w}px)`,
      );
      await padiCall("chrome/setCanvasLayout", {
        id: tile.id,
        layout: { x: tile.x, y: tile.y, w: tile.w - px, h: tile.h },
      });
    }
    // The tile must actually be narrower before the control is believed —
    // this is also the proof that the record round-tripped.
    await this.page.waitForFunction(
      ({ sel, want }) => {
        for (const [id, width] of Object.entries(want)) {
          const node = document.querySelector(
            `${sel}[data-terminal-id="${id}"]`,
          );
          if (!(node instanceof HTMLElement)) return false;
          if (Math.abs(Number.parseFloat(node.style.width) - width) > 1)
            return false;
        }
        return true;
      },
      {
        sel: CANVAS_TILE_SELECTOR,
        want: Object.fromEntries(tiles.map((t) => [t.id, t.w - px])),
      },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// ── The positive control ──
//
// Every scenario makes one DELIBERATE box change while the recorders are
// running and proves it was recorded, before it goes on to claim that
// something else changed nothing. Without it a green says only "this
// instrument reported nothing", which is also what a broken instrument says.

/** Wait until every named program's record has grown past its baseline. */
async function waitForGrowth(
  what: string,
  watched: readonly string[],
): Promise<void> {
  const baselines = new Map(
    watched.map((id) => [id, recorded.get(id)?.baseline ?? []]),
  );
  await pollFor({
    observe: readAll,
    isDone: (now) =>
      watched.every(
        (id) => (now.get(id)?.length ?? 0) > (baselines.get(id)?.length ?? 0),
      ),
    timeoutMs: POLL_TIMEOUT,
    intervalMs: SAMPLE_MS,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what}: the box moved and ${elapsedMs}ms later these programs had not been ` +
          "told — so this scenario's negative would have passed on an instrument " +
          "that reports nothing at all:\n" +
          watched
            .map(
              (id) =>
                `  ${recorded.get(id)?.label ?? id}: was ${formatWinsizes(
                  baselines.get(id) ?? [],
                )}, now ${formatWinsizes(last?.get(id) ?? [])}`,
            )
            .join("\n"),
      ),
  });
}

Then(
  "every recorded program was told a new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    assert.ok(recorded.size > 0, "no terminal is being recorded");
    await waitForGrowth("the deliberate box change", recordedIds());
  },
);

Then(
  "the program in the main pane was told a new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = await this.page.evaluate(
      (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
      MAIN_PANE,
    );
    assert.ok(id, "no visible main pane");
    assert.ok(recorded.has(id), `the main pane (${id}) is not being recorded`);
    await waitForGrowth("the deliberate box change", [id]);
  },
);

// ── Assert ──

Then(
  "no recorded program was told a new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    assert.ok(recorded.size > 0, "no terminal is being recorded");
    await holdQuiet(this, "after the act");
  },
);

Then(
  "the program in canvas tile {int} was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld, position: number) {
    const ids = await this.page.evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .map((tile) => tile.getAttribute("data-terminal-id"))
          .filter((id): id is string => !!id),
      CANVAS_TILE_SELECTOR,
    );
    const id = ids[position - 1];
    assert.ok(id, `there is no canvas tile ${position} (saw ${ids.length})`);
    assert.ok(
      recorded.has(id),
      `canvas tile ${position} (${id}) is not being recorded`,
    );
    await holdQuiet(this, `canvas tile ${position}`, [id]);
  },
);

Then(
  "the program in the main pane was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = await this.page.evaluate(
      (sel) => document.querySelector(sel)?.getAttribute("data-terminal-id"),
      MAIN_PANE,
    );
    assert.ok(id, "no visible main pane");
    assert.ok(recorded.has(id), `the main pane (${id}) is not being recorded`);
    await holdQuiet(this, "the main pane", [id]);
  },
);

Then(
  "every program that was already running was told no new size",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const newest = this.createdTerminalIds.at(-1);
    assert.ok(newest, "no terminal was created in this scenario");
    const earlier = recordedIds().filter((id) => id !== newest);
    assert.ok(earlier.length > 0, "nothing was recorded before the new one");
    await holdQuiet(this, "the terminals that were already there", earlier);
  },
);

Then(
  "the new terminal's program was told at most one new size, ending at its pane's grid",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = this.createdTerminalIds.at(-1);
    assert.ok(id, "no terminal was created in this scenario");
    const entry = recorded.get(id);
    assert.ok(entry, `the new terminal (${id}) is not being recorded`);
    const sizes = await readWinsizes(id);
    const pane = await this.page.evaluate((sel) => {
      const node = document.querySelector(sel);
      if (!(node instanceof HTMLDivElement) || !node.__xterm) return null;
      return { cols: node.__xterm.cols, rows: node.__xterm.rows };
    }, paneSelector(id));
    assert.ok(pane, `the new terminal (${id}) has no mounted xterm to compare`);
    const last = sizes.at(-1);
    assert.ok(last, "the new terminal's program printed nothing");
    const wire = await quoteResizeWire(this.page, recordedIds());
    // The record STARTS where the recorder could first be started — the spawn
    // grid when the race was won, the settled grid when it was not — so the
    // claim is about distinct sizes the program ever had, not about entries.
    const distinct = new Set(sizes.map((s) => `${s.cols}x${s.rows}`));
    assert.ok(
      distinct.size <= 2,
      `the new terminal's program was told ${distinct.size} different sizes, not one: ` +
        `${formatWinsizes(sizes)}\n${wire}`,
    );
    assert.deepStrictEqual(
      { cols: last.cols, rows: last.rows },
      pane,
      `the new terminal's program ended at ${last.cols}x${last.rows} while its pane is ` +
        `${pane.cols}x${pane.rows}: ${formatWinsizes(sizes)}\n${wire}`,
    );
  },
);

Then(
  "the size record should be reported as {string}",
  async function (this: KoluWorld, label: string) {
    // The measurement's OUTPUT, not an assertion: every scenario ends by
    // printing what each program was told, so a GREEN run still carries the
    // numbers this phase exists to collect. `console.log` rather than an
    // attachment: the lane's own log is what a CI reader has in hand.
    const lines: string[] = [];
    for (const [id, entry] of recorded) {
      lines.push(`  ${entry.label}: ${formatWinsizes(await readWinsizes(id))}`);
    }
    console.log(`[mount-size] ${label}\n${lines.join("\n")}`);
  },
);
