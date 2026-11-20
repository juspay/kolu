import * as assert from "node:assert";
import * as path from "node:path";
import { Then, When } from "@cucumber/cucumber";
import {
  ACTIVE_TERMINAL,
  readBufferText,
  waitForBufferContains,
} from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  CANVAS_TILE_SELECTOR,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";
import { codexMockCwd } from "./codex_steps.ts";

const CANVAS_SELECTOR = '[data-testid="canvas-container"]';

const sleptIdByWorld = new WeakMap<KoluWorld, string>();
const splitIdByWorld = new WeakMap<KoluWorld, string>();

async function activeTileId(world: KoluWorld): Promise<string> {
  const id = await world.page.evaluate((activeTileSel) => {
    const tile = document.querySelector(activeTileSel);
    return tile?.getAttribute("data-terminal-id") ?? null;
  }, ACTIVE_CANVAS_TILE_SELECTOR);
  if (!id) throw new Error("No canvas tile on screen to sleep");
  return id;
}

async function sleepingTileId(world: KoluWorld): Promise<string> {
  const id = await pollFor({
    observe: () =>
      world.page.evaluate((sel) => {
        for (const tile of document.querySelectorAll(sel)) {
          if (tile.querySelector('[data-testid="dormant-tile-body"]')) {
            return tile.getAttribute("data-terminal-id");
          }
        }
        return null;
      }, CANVAS_TILE_SELECTOR),
    isDone: (v) => typeof v === "string" && v.length > 0,
    onTimeout: (_last, ms) =>
      new Error(`No sleeping (dormant) canvas tile appeared within ${ms}ms`),
    timeoutMs: POLL_TIMEOUT,
  });
  assert.ok(id, "No sleeping (dormant) canvas tile id resolved");
  return id;
}

async function waitForSleeping(world: KoluWorld, id: string): Promise<void> {
  await world.page.waitForFunction(
    ({ sel, tileId }) => {
      const tile = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"]`,
      );
      if (!tile) return false;
      const showsSleepingBody =
        tile.querySelector(
          '[data-testid="dormant-tile-body"][data-sleeping="true"]',
        ) !== null;
      const stillPaintsLiveXterm = tile.querySelector(".xterm-screen") !== null;
      return showsSleepingBody && !stillPaintsLiveXterm;
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id },
    { timeout: POLL_TIMEOUT },
  );
}

async function waitForLive(world: KoluWorld, id: string): Promise<void> {
  await world.page.waitForFunction(
    ({ sel, tileId }) => {
      const tile = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"]`,
      );
      if (!tile) return false;
      const paintsLiveXterm = tile.querySelector(".xterm-screen") !== null;
      const stillShowsDormantBody =
        tile.querySelector('[data-testid="dormant-tile-body"]') !== null;
      return paintsLiveXterm && !stillShowsDormantBody;
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id },
    { timeout: POLL_TIMEOUT },
  );
}

async function clickWakeButton(world: KoluWorld, id: string): Promise<void> {
  await world.page.evaluate(
    ({ sel, tileId }) => {
      const btn = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"] [data-testid="dormant-tile-body"] [data-testid="wake-button"]`,
      ) as HTMLButtonElement | null;
      if (!btn) throw new Error(`wake-button not found for ${tileId}`);
      btn.click();
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id },
  );
}

async function moveSleepingTile(
  world: KoluWorld,
  id: string,
  x: number,
  y: number,
): Promise<void> {
  const layout = { x, y, w: 700, h: 500 };
  await padiCall("chrome/setCanvasLayout", { id, layout });
  await waitForSleepingTileAt(world, id, x, y);
}

async function waitForSleepingTileAt(
  world: KoluWorld,
  id: string,
  x: number,
  y: number,
): Promise<void> {
  await world.page.waitForFunction(
    ({ sel, tileId, wantX, wantY }) => {
      const tile = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"]`,
      ) as HTMLElement | null;
      if (!tile) return false;
      const host = tile.closest("[style*='left']") as HTMLElement | null;
      const styled = host ?? tile;
      return (
        Math.abs(Number.parseFloat(styled.style.left) - wantX) < 1 &&
        Math.abs(Number.parseFloat(styled.style.top) - wantY) < 1
      );
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id, wantX: x, wantY: y },
    { timeout: POLL_TIMEOUT },
  );
}

When(
  "I sleep the active terminal via the tile sleep button",
  async function (this: KoluWorld) {
    const id = await activeTileId(this);
    sleptIdByWorld.set(this, id);
    await this.page.evaluate(
      ({ sel, tileId }) => {
        const btn = document.querySelector(
          `${sel}[data-terminal-id="${tileId}"] [data-testid="tile-sleep"]`,
        ) as HTMLButtonElement | null;
        if (!btn) throw new Error(`tile-sleep button not found for ${tileId}`);
        btn.click();
      },
      { sel: CANVAS_TILE_SELECTOR, tileId: id },
    );
  },
);

When(
  "I wake the slept terminal via the dormant body wake button",
  async function (this: KoluWorld) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    await clickWakeButton(this, id);
  },
);

When("I remember the tile's split pane", async function (this: KoluWorld) {
  const tileId = await activeTileId(this);
  const subId = await pollFor({
    observe: () =>
      this.page.evaluate(
        ({ sel, tileId }) =>
          document
            .querySelector(
              `${sel}[data-terminal-id="${tileId}"] [data-sub-terminal][data-terminal-id]`,
            )
            ?.getAttribute("data-terminal-id") ?? null,
        { sel: CANVAS_TILE_SELECTOR, tileId },
      ),
    isDone: (v) => typeof v === "string" && v.length > 0,
    onTimeout: (_last, ms) =>
      new Error(`No split pane appeared in the active tile within ${ms}ms`),
    timeoutMs: POLL_TIMEOUT,
  });
  assert.ok(subId, "No split pane id resolved");
  sleptIdByWorld.set(this, tileId);
  splitIdByWorld.set(this, subId);
});

When("I click the tile restart button", async function (this: KoluWorld) {
  const id = await activeTileId(this);
  sleptIdByWorld.set(this, id);
  await this.page.evaluate(
    ({ sel, tileId }) => {
      const btn = document.querySelector(
        `${sel}[data-terminal-id="${tileId}"] [data-testid="tile-restart"]`,
      ) as HTMLButtonElement | null;
      if (!btn) throw new Error(`tile-restart button not found for ${tileId}`);
      btn.click();
    },
    { sel: CANVAS_TILE_SELECTOR, tileId: id },
  );
});

When(
  "I wake the restored sleeping tile via the dormant body wake button",
  async function (this: KoluWorld) {
    const id = await sleepingTileId(this);
    sleptIdByWorld.set(this, id);
    await clickWakeButton(this, id);
  },
);

When(
  "I move the sleeping tile to x={int} y={int}",
  async function (this: KoluWorld, x: number, y: number) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    await moveSleepingTile(this, id, x, y);
  },
);

Then("the slept terminal should be sleeping", async function (this: KoluWorld) {
  const id = sleptIdByWorld.get(this);
  assert.ok(id, "No slept terminal id captured — call the sleep step first");
  await waitForSleeping(this, id);
});

Then(
  "the dormant tile should show its saved working directory",
  async function (this: KoluWorld) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    const leaf = path.basename(codexMockCwd());
    await this.page.waitForFunction(
      ({ sel, tileId, want }) => {
        const el = document.querySelector(
          `${sel}[data-terminal-id="${tileId}"] [data-testid="dormant-cwd"]`,
        );
        return (el?.textContent ?? "").includes(want);
      },
      { sel: CANVAS_TILE_SELECTOR, tileId: id, want: leaf },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the slept terminal should be live", async function (this: KoluWorld) {
  const id = sleptIdByWorld.get(this);
  assert.ok(id, "No slept terminal id captured — call the sleep step first");
  await waitForLive(this, id);
});

Then(
  "the tile and its {int} split pane(s) should be dormant",
  async function (this: KoluWorld, splitCount: number) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    await this.page.waitForFunction(
      ({ sel, tileId, count }) => {
        const tile = document.querySelector(
          `${sel}[data-terminal-id="${tileId}"]`,
        );
        if (!tile) return false;
        const bodies = [
          ...tile.querySelectorAll(
            '[data-testid="dormant-tile-body"][data-sleeping="true"]',
          ),
        ];
        const sizes = bodies.map((b) => b.getAttribute("data-size"));
        const stillPaintsLiveXterm =
          tile.querySelector(".xterm-screen") !== null;
        return (
          bodies.length === count + 1 &&
          sizes.filter((s) => s === "tile").length === 1 &&
          sizes.filter((s) => s === "sub").length === count &&
          !stillPaintsLiveXterm
        );
      },
      { sel: CANVAS_TILE_SELECTOR, tileId: id, count: splitCount },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the tile and its split should be live again",
  async function (this: KoluWorld) {
    const id = sleptIdByWorld.get(this);
    const splitId = splitIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    assert.ok(
      splitId,
      "No split pane id remembered — call the split step first",
    );
    await waitForLive(this, id);
    await this.page.waitForFunction(
      ({ sel, tileId, subId }) => {
        const tile = document.querySelector(
          `${sel}[data-terminal-id="${tileId}"]`,
        );
        if (!tile) return false;
        return (
          tile.querySelector(
            `[data-sub-terminal][data-terminal-id="${subId}"]`,
          ) !== null &&
          tile.querySelector('[data-testid="dormant-tile-body"]') === null
        );
      },
      { sel: CANVAS_TILE_SELECTOR, tileId: id, subId: splitId },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "no toast mentioning {string} should have been shown",
  async function (this: KoluWorld, needle: string) {
    const seen = await this.page.evaluate(
      () =>
        (window as unknown as { __errorToasts?: string[] }).__errorToasts ?? [],
    );
    const offending = seen.filter((t) => t.includes(needle));
    assert.deepStrictEqual(
      offending,
      [],
      `Expected no toast mentioning "${needle}", saw: ${JSON.stringify(offending)}`,
    );
  },
);

Then(
  "the terminal buffer should no longer contain {string}",
  async function (this: KoluWorld, text: string) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No terminal id captured — click the restart button first");
    await waitForLive(this, id);
    await this.page.waitForFunction(
      (sel) => (window.__readXtermBuffer?.(sel, 0) ?? "").trim() !== "",
      ACTIVE_TERMINAL,
      { timeout: POLL_TIMEOUT, polling: 50 },
    );
    await this.page.waitForFunction(
      ({ sel, exp }) =>
        !(window.__readXtermBuffer?.(sel, 0) ?? "").includes(exp),
      { sel: ACTIVE_TERMINAL, exp: text },
      { timeout: POLL_TIMEOUT, polling: 50 },
    );
  },
);

Then(
  "the restore card should mark a sleeping terminal as asleep",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () =>
        document.querySelector(
          '[data-testid="session-restore"] [data-testid="restore-sleeping"]',
        ) !== null,
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the restored sleeping tile should be sleeping",
  async function (this: KoluWorld) {
    const id = await sleepingTileId(this);
    sleptIdByWorld.set(this, id);
    await waitForSleeping(this, id);
  },
);

Then(
  "the restored sleeping tile should be live",
  async function (this: KoluWorld) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No restored sleeping tile id captured — wake it first");
    await waitForLive(this, id);
  },
);

Then(
  "the sleeping tile should be at x={int} y={int}",
  async function (this: KoluWorld, x: number, y: number) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept terminal id captured — call the sleep step first");
    await waitForSleepingTileAt(this, id, x, y);
  },
);

Then(
  "there should be exactly {int} canvas tile(s)",
  async function (this: KoluWorld, expected: number) {
    const fullSelector = `${CANVAS_SELECTOR} ${CANVAS_TILE_SELECTOR}`;
    await this.page.waitForFunction(
      ({ sel, count }) => document.querySelectorAll(sel).length === count,
      { sel: fullSelector, count: expected },
      { timeout: POLL_TIMEOUT },
    );
    const actual = await this.page.locator(fullSelector).count();
    assert.strictEqual(
      actual,
      expected,
      `Expected exactly ${expected} canvas tile(s), got ${actual}`,
    );
  },
);

When(
  "I toggle the dock's sleeping-terminal filter",
  async function (this: KoluWorld) {
    await this.page
      .locator(
        '[data-testid="dock-hidden-footer"] [data-testid="dock-sleeping-toggle"]',
      )
      .click();
  },
);

When(
  "I click the dock's show-all filter reset",
  async function (this: KoluWorld) {
    await this.page
      .locator(
        '[data-testid="dock-hidden-footer"] [data-testid="dock-hidden-show-all"]',
      )
      .click();
  },
);

Then(
  "the dock should show {int} sleeping row(s)",
  async function (this: KoluWorld, expected: number) {
    await this.page.waitForFunction(
      ({ count }) =>
        document.querySelectorAll(
          '[data-testid="dock-row"][data-bucket="sleeping"], [data-testid="dock-sub-row"][data-bucket="sleeping"]',
        ).length === count,
      { count: expected },
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the woken terminal should replay the agent resume invocation {string}",
  async function (this: KoluWorld, resumeInvocation: string) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept/woken terminal id captured");
    const scopedSelector = `${CANVAS_TILE_SELECTOR}[data-terminal-id="${id}"] [data-terminal-id][data-visible]`;
    try {
      await waitForBufferContains(this.page, resumeInvocation, {
        selector: scopedSelector,
      });
    } catch {
      const dump = await readBufferText(this.page, scopedSelector).catch(
        () => "",
      );
      throw new Error(
        `Woken terminal never replayed resume invocation "${resumeInvocation}" ` +
          `— a fresh/blank agent (the resume hole) would show exactly this. ` +
          `Buffer:\n${dump.slice(0, 800)}`,
      );
    }
  },
);

Then(
  "the woken terminal should resume in the same working directory",
  async function (this: KoluWorld) {
    const id = sleptIdByWorld.get(this);
    assert.ok(id, "No slept/woken terminal id captured");
    await this.terminalRun("pwd");
    const scopedSelector = `${CANVAS_TILE_SELECTOR}[data-terminal-id="${id}"] [data-terminal-id][data-visible]`;
    const wantCwdLeaf = path.basename(codexMockCwd());
    try {
      await waitForBufferContains(this.page, wantCwdLeaf, {
        selector: scopedSelector,
      });
    } catch {
      const dump = await readBufferText(this.page, scopedSelector).catch(
        () => "",
      );
      throw new Error(
        `Woken terminal's \`pwd\` never reported the saved cwd (…/${wantCwdLeaf}) ` +
          `— resume landed in the wrong cwd, not where the agent was slept. ` +
          `Buffer:\n${dump.slice(0, 800)}`,
      );
    }
  },
);
