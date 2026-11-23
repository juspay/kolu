/** WHAT A WORK'S TERMINAL IS TOLD — the size a Conductor pane sets, and that
 *  nothing else takes it back. Steps for `conductor-live-terminals.feature`'s
 *  sizing scenarios.
 *
 *  The instrument is the size recorder (`support/winsizeRecorder.ts`): a
 *  stand-in program that writes down the size it has at start and on every
 *  SIGWINCH, read back through the daemon's own mirror — the pane under
 *  measurement is never also the measuring instrument. A program is told a
 *  size only when the PTY really changes (kaval drops a same-size resize), so
 *  "told nothing" means nothing changed, not "nothing was asked".
 *
 *  Each recorded terminal is named by its role in the work, and the record is
 *  read FORWARD: every assertion accounts for the sizes told since the last
 *  one, so a scenario reads as the story of what its terminals were told.
 *  Every claim about how many sizes were told is HELD for three seconds,
 *  sampled four times a second (the window `mount-size-stability.feature`
 *  uses: a 250 ms publish settle, a 750 ms foreign-grid settle, kaval's 600 ms
 *  resize window and the trip itself) — a size told late is still caught. */

import assert from "node:assert";
import { After, Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import {
  awaitRecorder,
  formatWinsizes,
  readWinsizes,
  recorderCommand,
  startRecorder,
  type Winsize,
} from "../support/winsizeRecorder.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { paneOf } from "./conductor_live_steps.ts";
import { enterConductor, runImplementor } from "./conductor_steps.ts";

const HOLD_MS = 3_000;
const SAMPLE_MS = 250;
const FLOOR = { cols: 80, rows: 24 };

/** A recorded terminal: its id, and how much of its record is accounted for. */
interface Recorded {
  readonly id: string;
  seen: number;
}

/** By role in the work. Module scope is safe: cucumber runs one scenario's
 *  steps serially in one worker. */
const recorded = new Map<string, Recorded>();

After(() => {
  recorded.clear();
});

function recordOf(role: string): Recorded {
  const r = recorded.get(role);
  assert.ok(r, `no size recorder is running for the ${role}`);
  return r;
}

/** Wait for `role`'s program to have been told `count` sizes since the last
 *  assertion, then hold that for {@link HOLD_MS}: one more inside the window
 *  fails. Answers those sizes and marks them accounted for. */
async function toldExactly(
  world: KoluWorld,
  role: string,
  count: number,
): Promise<Winsize[]> {
  const r = recordOf(role);
  const since = async () => (await readWinsizes(r.id)).slice(r.seen);
  await pollFor({
    observe: since,
    isDone: (told) => told.length >= count,
    timeoutMs: POLL_TIMEOUT,
    intervalMs: SAMPLE_MS,
    onTimeout: (told, ms) =>
      new Error(
        `the ${role}'s program was told ${told?.length ?? 0} sizes after ${ms}ms, expected ${count}: ${formatWinsizes(told ?? [])}`,
      ),
  });
  const start = Date.now();
  let told = await since();
  while (Date.now() - start < HOLD_MS) {
    if (told.length > count) break;
    await world.page.waitForTimeout(SAMPLE_MS);
    told = await since();
  }
  assert.equal(
    told.length,
    count,
    `the ${role}'s program was told ${told.length} sizes, expected exactly ${count} held for ${HOLD_MS}ms: ${formatWinsizes(await readWinsizes(r.id))}`,
  );
  r.seen += count;
  return told;
}

/** The size the pane's head says its terminal is. */
async function readout(world: KoluWorld, role: string): Promise<string> {
  return (
    (await world.page
      .locator(`${paneOf(role)} [data-testid="live-grid"]`)
      .textContent({ timeout: POLL_TIMEOUT })) ?? ""
  );
}

const spelled = (s: Winsize): string => `${s.cols}×${s.rows}`;

/** The implementor, run by kolu as always, but the program its stand-in
 *  `claude` execs is the size recorder. */
When(
  "I ask the conductor to run a size recorder as the implementor in the work's repo",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const id = await runImplementor(this, recorderCommand());
    await awaitRecorder(id);
    recorded.set("implementor", { id, seen: 1 });
  },
);

When(
  "I start a size recorder for the {word} in the terminal I am in",
  { timeout: 120_000 },
  async function (this: KoluWorld, role: string) {
    const id = this.createdTerminalIds.at(-1);
    assert.ok(id, 'no terminal was created — call "I create a terminal" first');
    await startRecorder(id);
    recorded.set(role, { id, seen: 1 });
  },
);

When("I go back to the conductor", async function (this: KoluWorld) {
  await enterConductor(this);
});

When(
  "I open the {word}'s tile from its live pane",
  async function (this: KoluWorld, role: string) {
    await this.page
      .locator(`${paneOf(role)} [data-testid="live-open-tile"]`)
      .click();
  },
);

Then(
  "the {word}'s program should be told one size larger than 80x24",
  { timeout: 120_000 },
  async function (this: KoluWorld, role: string) {
    const [size] = await toldExactly(this, role, 1);
    assert.ok(size);
    assert.ok(
      size.cols > FLOOR.cols && size.rows > FLOOR.rows,
      `the ${role}'s program was told ${spelled(size)}, not larger than 80×24`,
    );
  },
);

Then(
  "the {word} live pane should show the size its program was told",
  async function (this: KoluWorld, role: string) {
    const r = recordOf(role);
    const last = (await readWinsizes(r.id)).at(-1);
    assert.ok(last, `the ${role}'s program recorded nothing`);
    await pollFor({
      observe: () => readout(this, role),
      isDone: (shown) => shown === spelled(last),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (shown, ms) =>
        new Error(
          `the ${role}'s pane shows ${JSON.stringify(shown)} after ${ms}ms, not the ${spelled(last)} its program was told`,
        ),
    });
  },
);

Then(
  "the {word}'s program should be told nothing more",
  { timeout: 120_000 },
  async function (this: KoluWorld, role: string) {
    await toldExactly(this, role, 0);
  },
);

Then(
  "the {word}'s program should be told one new size",
  { timeout: 120_000 },
  async function (this: KoluWorld, role: string) {
    await toldExactly(this, role, 1);
  },
);

/** The pane's size: the one its head reads once the size has landed. */
Then(
  "the {word}'s program should be told its pane's size, and nothing else",
  { timeout: 120_000 },
  async function (this: KoluWorld, role: string) {
    const [size] = await toldExactly(this, role, 1);
    assert.ok(size);
    assert.equal(
      await readout(this, role),
      spelled(size),
      `the ${role}'s program was told ${spelled(size)}, not the size its pane shows`,
    );
  },
);

/** The tile's size: the one the program started at, in the tile, before the
 *  Conductor ever showed it. */
Then(
  "the {word}'s program should be told its tile's size",
  { timeout: 120_000 },
  async function (this: KoluWorld, role: string) {
    const r = recordOf(role);
    const [first] = await readWinsizes(r.id);
    const [size] = await toldExactly(this, role, 1);
    assert.ok(first && size);
    assert.equal(
      spelled(size),
      spelled(first),
      `the ${role}'s program was told ${spelled(size)}, not its tile's ${spelled(first)}`,
    );
  },
);

/** THE FLOOR. Held over every recorded program at once, with a positive
 *  control: at least one of them must have been told something, or a pane
 *  that never sized would pass. */
Then(
  "no recorded program should be told less than 80x24",
  { timeout: 120_000 },
  async function (this: KoluWorld) {
    const all = async () =>
      Promise.all(
        [...recorded.entries()].map(async ([role, r]) => ({
          role,
          told: (await readWinsizes(r.id)).slice(r.seen),
        })),
      );
    await pollFor({
      observe: all,
      isDone: (each) => each.some((e) => e.told.length > 0),
      timeoutMs: POLL_TIMEOUT,
      intervalMs: SAMPLE_MS,
      onTimeout: (_each, ms) =>
        new Error(`no recorded program was told any size after ${ms}ms`),
    });
    await this.page.waitForTimeout(HOLD_MS);
    for (const { role, told } of await all()) {
      for (const size of told) {
        assert.ok(
          size.cols >= FLOOR.cols && size.rows >= FLOOR.rows,
          `the ${role}'s program was told ${spelled(size)}, below 80×24: ${formatWinsizes(told)}`,
        );
      }
      recordOf(role).seen += told.length;
    }
  },
);
