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

interface PresenceObservation {
  kind: string;
  basename: string;
  starting: { state: string | null; kind: string | null } | null;
  fresh: { state: string | null; kind: string | null } | null;
  attention: { awaiting: number; needsYou: number };
}

let sweep: PresenceObservation[] = [];
let standInDir: string | null = null;

After({ tags: "@presence-registry" }, () => {
  if (standInDir && fs.existsSync(standInDir)) {
    fs.rmSync(standInDir, { recursive: true, force: true });
  }
  standInDir = null;
  sweep = [];
});

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

  observation.starting = await awaitIndicator(world, entry.kind, "starting");

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

  await world.page.keyboard.type("quit");
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, standInGoneLine(entry.kind));
  return observation;
}

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
