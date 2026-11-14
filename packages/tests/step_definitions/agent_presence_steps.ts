/** Presence for EVERY registered agent — step definitions.
 *
 *  The omp scenarios in `agent-presence.feature` prove the two presence states
 *  against one faithful fake. This pair of steps proves the BREADTH claim that
 *  padi actually makes: presence is minted from the foreground alone, for any
 *  agent whose binary name the registry knows. The kind list is read off
 *  `AGENT_VOCABS` at runtime (`registeredStandIns`), so registering an eighth
 *  agent extends this scenario without a line changing here or in the feature.
 *
 *  Shape: the `When` DOES the whole sweep and records what it saw; the `Then`
 *  asserts that ledger. A loop that asserted inline would fail on the first
 *  agent and say nothing about the other six, which is the opposite of what a
 *  breadth test is for — this way one run names every kind that misbehaved.
 *
 *  The agents are brought up ONE AT A TIME in the scenario's single terminal
 *  rather than in seven of their own: presence is a per-terminal process fact,
 *  the `starting` half needs the terminal's keyboard focus to drive `settle`,
 *  and seven live PTYs plus seven tiles of canvas buy nothing the sequence does
 *  not already prove (the tile's indicator is asserted WITH its kind, so a
 *  previous agent's settled indicator can never satisfy the next agent's wait).
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import {
  presenceMockPayload,
  registeredStandIns,
  stageStandInBins,
  standInGoneLine,
  standInUpLine,
} from "../support/agent-mock-presence.ts";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import {
  AWAITING_ROW_SELECTOR,
  NEEDS_YOU_ENTRY_SELECTOR,
} from "./dock_steps.ts";

/** What one agent's bring-up left behind: the indicator kind/state seen at each
 *  half, and the attention counted while it stood there. Every field is a
 *  reading, never an assertion — the `Then` judges them. */
interface PresenceObservation {
  kind: string;
  basename: string;
  starting: { state: string | null; kind: string | null } | null;
  fresh: { state: string | null; kind: string | null } | null;
  /** Dock awaiting rows + needs-you entries, counted while this agent was up. */
  attention: { awaiting: number; needsYou: number };
}

/** The sweep's output, module state for the same reason every other mock's
 *  fixture is: cucumber hands the `Then` no value from the `When`. */
let sweep: PresenceObservation[] = [];
/** The scenario-owned directory holding the renamed `bash` copies and each
 *  stand-in's settle flag. Removed by the `After` hook below. */
let standInDir: string | null = null;

After({ tags: "@presence-registry" }, () => {
  if (standInDir && fs.existsSync(standInDir)) {
    fs.rmSync(standInDir, { recursive: true, force: true });
  }
  standInDir = null;
  sweep = [];
});

/** The tile chrome's agent indicator — the same element `omp_steps.ts` reads,
 *  asked generically (kind comes back rather than being matched inside). */
async function observeIndicator(
  world: KoluWorld,
): Promise<{ state: string | null; kind: string | null }> {
  return world.page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
    );
    return {
      state: el?.getAttribute("data-agent-state") ?? null,
      kind: el?.getAttribute("data-agent-kind") ?? null,
    };
  });
}

/** Wait for the indicator to read one agent's kind in one state, and give back
 *  what was actually there when it did (or last was, on timeout) — a reading,
 *  so a kind that never arrives is reported beside the six that did instead of
 *  ending the sweep. */
async function awaitIndicator(
  world: KoluWorld,
  kind: string,
  state: string,
): Promise<{ state: string | null; kind: string | null } | null> {
  try {
    return await pollFor({
      observe: () => observeIndicator(world),
      isDone: (o) => o.kind === kind && o.state === state,
      onTimeout: (last, ms) =>
        new Error(
          `no "${state}" indicator for ${kind} after ${ms}ms (saw state="${last?.state ?? null}" kind="${last?.kind ?? null}")`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  } catch {
    return await observeIndicator(world);
  }
}

/** The two attention surfaces, counted off the dock's own selectors. */
async function countAttention(
  world: KoluWorld,
): Promise<{ awaiting: number; needsYou: number }> {
  return world.page.evaluate(
    ({ awaitingSel, needsYouSel }) => ({
      awaiting: document.querySelectorAll(awaitingSel).length,
      needsYou: document.querySelectorAll(needsYouSel).length,
    }),
    {
      awaitingSel: AWAITING_ROW_SELECTOR,
      needsYouSel: NEEDS_YOU_ENTRY_SELECTOR,
    },
  );
}

/** Bring one agent up, read both halves, and put it away again. Throws only for
 *  conditions that mean the stand-in itself never ran (the arrangement); a
 *  wrong or missing indicator comes back as a reading. */
async function sweepOneAgent(
  world: KoluWorld,
  entry: { kind: string; basename: string },
  bin: string,
  settleFlag: string,
): Promise<PresenceObservation> {
  const observation: PresenceObservation = {
    kind: entry.kind,
    basename: entry.basename,
    starting: null,
    fresh: null,
    attention: { awaiting: 0, needsYou: 0 },
  };
  const payload = presenceMockPayload({ kind: entry.kind, settleFlag });
  await world.page.keyboard.type(`${bin} -c '${payload}'`);
  await world.page.keyboard.press("Enter");
  try {
    await waitForBufferContains(world.page, standInUpLine(entry.kind));
  } catch (err) {
    const buffer = await readBufferText(world.page);
    throw new Error(
      `the ${entry.kind} stand-in (${entry.basename}) never said it was up: ${(err as Error).message}\n— terminal tail:\n${buffer.slice(-600)}`,
    );
  }

  // STARTING: the painter is still writing a line a second, so padi's quiet
  // window is held open and this is a state the step ends rather than races.
  observation.starting = await awaitIndicator(world, entry.kind, "starting");

  // The screen goes quiet: the painter's loop sees the flag and exits.
  await world.page.keyboard.type("settle");
  await world.page.keyboard.press("Enter");
  await pollFor({
    observe: async () => fs.existsSync(settleFlag),
    isDone: (seen) => seen === true,
    onTimeout: (_last, ms) =>
      new Error(
        `the ${entry.kind} stand-in never acknowledged settle within ${ms}ms`,
      ),
    timeoutMs: POLL_TIMEOUT,
  });
  observation.fresh = await awaitIndicator(world, entry.kind, "fresh");
  observation.attention = await countAttention(world);

  // The agent leaves the foreground, and its presence ends with the process —
  // the terminal is a plain shell again before the next stand-in launches.
  await world.page.keyboard.type("quit");
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, standInGoneLine(entry.kind));
  return observation;
}

/** Each agent gets the full bring-up budget plus its own settle and teardown;
 *  the ceiling scales with the REGISTRY, so an eighth agent widens the step's
 *  deadline the same way it widens its work. */
const SWEEP_TIMEOUT = registeredStandIns().length * 90_000;

When(
  "every registered agent is brought up in turn, writing no session",
  { timeout: SWEEP_TIMEOUT },
  async function (this: KoluWorld) {
    const standIns = registeredStandIns();
    assert.ok(
      standIns.length > 0,
      "the agent registry named no agents — the sweep would prove nothing",
    );
    const staged = stageStandInBins(standIns);
    standInDir = staged.dir;
    sweep = [];
    for (const entry of standIns) {
      const bin = staged.bins[entry.kind];
      assert.ok(bin, `no stand-in binary staged for ${entry.kind}`);
      sweep.push(
        await sweepOneAgent(
          this,
          entry,
          bin,
          path.join(staged.dir, `${entry.kind}-settled`),
        ),
      );
    }
  },
);

Then(
  "each registered agent should have read Starting then Ready, asking for nobody",
  async function (this: KoluWorld) {
    assert.ok(sweep.length > 0, "no agents were swept — run the When step");
    const expected = registeredStandIns().map((s) => s.kind);
    assert.deepStrictEqual(
      sweep.map((o) => o.kind),
      expected,
      "the sweep did not cover every registered agent",
    );
    const wrong = sweep.filter(
      (o) =>
        o.starting?.state !== "starting" ||
        o.starting?.kind !== o.kind ||
        o.fresh?.state !== "fresh" ||
        o.fresh?.kind !== o.kind ||
        o.attention.awaiting !== 0 ||
        o.attention.needsYou !== 0,
    );
    assert.deepStrictEqual(
      wrong.map(
        (o) =>
          `${o.kind} (${o.basename}): starting=${o.starting?.state ?? "none"}/${o.starting?.kind ?? "none"} fresh=${o.fresh?.state ?? "none"}/${o.fresh?.kind ?? "none"} awaiting=${o.attention.awaiting} needs-you=${o.attention.needsYou}`,
      ),
      [],
      "every registered agent must read Starting then Ready from its foreground alone, and ask for nobody",
    );
  },
);
