import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL } from "../support/buffer.ts";
import {
  GRID_ROUND_TRIP_MS,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

When("I reload the page and wait for ready", async function (this: KoluWorld) {
  await this.page.reload();
  await this.waitForReady();
});

Then(
  "the scroll lock toggle should be disabled",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="scroll-lock-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="scroll-lock-toggle"]')
          ?.getAttribute("data-enabled") === null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the attention alerts toggle should be disabled",
  async function (this: KoluWorld) {
    const toggle = this.page.locator('[data-testid="attention-alerts-toggle"]');
    await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="attention-alerts-toggle"]')
          ?.getAttribute("data-enabled") === null,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I click the {string} renderer button",
  async function (this: KoluWorld, value: string) {
    await this.page.click(`[data-testid="terminal-renderer-${value}"]`);
    await this.waitForFrame();
  },
);

Then(
  "the terminal renderer should be {string}",
  async function (this: KoluWorld, renderer: string) {
    await this.page.waitForFunction(
      (expected) =>
        document
          .querySelector("[data-visible][data-terminal-id]")
          ?.getAttribute("data-renderer") === expected,
      renderer,
      { timeout: POLL_TIMEOUT },
    );
  },
);

interface RememberedGrid {
  cols: number;
  rows: number;
  renderer: string | null;
}

const rememberedByWorld = new WeakMap<KoluWorld, RememberedGrid>();

function readTile(world: KoluWorld): Promise<RememberedGrid> {
  return world.page.evaluate((sel) => {
    const container = document.querySelector(sel) as
      | (HTMLElement & { __xterm?: { cols: number; rows: number } })
      | null;
    const term = container?.__xterm;
    if (!container || !term) throw new Error(`no __xterm on ${sel}`);
    return {
      cols: term.cols,
      rows: term.rows,
      renderer: container.getAttribute("data-renderer"),
    };
  }, ACTIVE_TERMINAL);
}

When("I remember the active terminal's grid", async function (this: KoluWorld) {
  const remembered = await readTile(this);
  if (remembered.cols === 80 && remembered.rows === 24) {
    throw new Error(
      "the active terminal reports xterm's unmeasured default 80x24 — it has not been fitted to its box, so this scenario would prove nothing",
    );
  }
  if (remembered.renderer !== "webgl") {
    throw new Error(
      `the active terminal is drawn by "${remembered.renderer}", not WebGL — this scenario compares the WebGL grid with the DOM one, so it cannot start here`,
    );
  }
  rememberedByWorld.set(this, remembered);
});

Then(
  "the active terminal's grid should stay unchanged",
  async function (this: KoluWorld) {
    const expected = rememberedByWorld.get(this);
    if (!expected)
      throw new Error("no grid remembered — the When step must run first");
    const deadline = Date.now() + GRID_ROUND_TRIP_MS;
    do {
      const tile = await readTile(this);
      if (tile.cols !== expected.cols || tile.rows !== expected.rows) {
        throw new Error(
          `the renderer change resized the terminal: ${expected.cols}x${expected.rows} under "${expected.renderer}" became ${tile.cols}x${tile.rows} under "${tile.renderer}"`,
        );
      }
      await this.waitForFrame();
    } while (Date.now() < deadline);
  },
);
