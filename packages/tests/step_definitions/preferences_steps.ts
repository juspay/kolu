import { Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

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

/** The grid the remembering step captured, compared by the two steps below.
 *  Module scope is safe: cucumber runs one scenario's steps serially in one
 *  worker process (same reasoning as `canvas_selection_steps.ts`). */
let rememberedGrid: { cols: number; rows: number } | null = null;

/** The active tile's REAL grid, read off the live xterm through the `__xterm`
 *  e2e bridge. `cols`/`rows` are what the PTY was sized to, so this is the
 *  quantity a renderer swap must not move. */
function readGrid(world: KoluWorld): Promise<{ cols: number; rows: number }> {
  return world.page.evaluate((sel) => {
    const container = document.querySelector(sel) as
      | (HTMLElement & { __xterm?: { cols: number; rows: number } })
      | null;
    const term = container?.__xterm;
    if (!term) throw new Error(`no __xterm on ${sel}`);
    return { cols: term.cols, rows: term.rows };
  }, ACTIVE_TERMINAL);
}

When("I remember the active terminal's grid", async function (this: KoluWorld) {
  rememberedGrid = await readGrid(this);
  // A grid of the constructor's invented 80×24 would make the comparison
  // vacuous — that is the value an UNMEASURED xterm reports, so a tile that
  // never measured would "keep" it through any renderer change.
  if (rememberedGrid.cols === 80 && rememberedGrid.rows === 24) {
    throw new Error(
      "the active terminal reports xterm's unmeasured default 80x24 — it has not been fitted to its box, so this scenario would prove nothing",
    );
  }
});

Then(
  "the active terminal's grid should stay unchanged",
  async function (this: KoluWorld) {
    const expected = rememberedGrid;
    if (!expected)
      throw new Error("no grid remembered — the When step must run first");
    // Hold the assertion for several frames rather than sampling once: a
    // re-fit is scheduled on an animation frame, so a swap that DOES resize
    // lands a frame or two after the renderer attribute flips. Fail on the
    // first divergence, quoting both grids.
    for (let frame = 0; frame < 10; frame++) {
      const grid = await readGrid(this);
      if (grid.cols !== expected.cols || grid.rows !== expected.rows) {
        throw new Error(
          `renderer change resized the terminal: ${expected.cols}x${expected.rows} became ${grid.cols}x${grid.rows}`,
        );
      }
      await this.waitForFrame();
    }
  },
);
