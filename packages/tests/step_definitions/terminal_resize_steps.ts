import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { readPerTerminal } from "../support/buffer.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Read cols from every terminal's live xterm, keyed by data-terminal-id so
 *  callers can match hidden vs. visible later. */
async function readAllCols(world: KoluWorld): Promise<Record<string, number>> {
  return readPerTerminal(world.page, "cols");
}

/** Which terminal id is currently visible (the data-visible flag sits
 *  on the same container as __xterm). */
async function visibleTerminalId(world: KoluWorld): Promise<string> {
  const id = await world.page.evaluate(() => {
    const el = document.querySelector(
      "[data-visible][data-terminal-id][data-font-size]",
    );
    return el?.getAttribute("data-terminal-id") ?? null;
  });
  assert.ok(id, "No visible terminal found");
  return id;
}

When("I wait for all terminals to settle", async function (this: KoluWorld) {
  // Poll until every mounted terminal reports a non-zero cols —
  // filters out the race where a still-mounting xterm hasn't
  // constructed its buffer yet.
  await this.page.waitForFunction(
    () => {
      const nodes = document.querySelectorAll(
        "[data-terminal-id][data-font-size]",
      );
      if (nodes.length === 0) return false;
      for (const n of nodes) {
        const term = (n as unknown as { __xterm?: { cols: number } }).__xterm;
        if (!term?.cols) return false;
      }
      return true;
    },
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I wait for the active terminal's grid to come back from the daemon",
  async function (this: KoluWorld) {
    // This is a ROUND TRIP, not a local refit, and the name says so.
    //
    // A pane no longer resizes its own xterm when its box moves: it measures
    // what the box can hold, states that as its wanted grid, and its xterm
    // changes size only where the daemon's mirror did — at the `resized`
    // frame on the attach stream. So after a viewport change the visible
    // terminal's `cols` moves once the client's settle window (GRID_SETTLE_MS,
    // 250ms) has elapsed AND the daemon has answered; an assertion that reads
    // `cols` without waiting for that is reading the OLD grid and is right
    // only by luck. POLL_TIMEOUT is many times the settle plus a round trip,
    // so a loaded runner has room without the budget becoming a bare sleep.
    assert.ok(
      this.snapshotCols,
      "Snapshot required — call 'I snapshot each terminal's cols' first",
    );
    const snapshot = this.snapshotCols;
    await this.page.waitForFunction(
      (snap) => {
        const el = document.querySelector(
          "[data-visible][data-terminal-id][data-font-size]",
        );
        if (!el) return false;
        const id = el.getAttribute("data-terminal-id");
        const term = (el as unknown as { __xterm?: { cols: number } }).__xterm;
        if (!id || !term?.cols) return false;
        const before = snap[id];
        return typeof before === "number" && term.cols !== before;
      },
      snapshot,
      { timeout: POLL_TIMEOUT },
    );
  },
);

When("I snapshot each terminal's cols", async function (this: KoluWorld) {
  this.snapshotCols = await readAllCols(this);
  assert.ok(
    Object.keys(this.snapshotCols).length >= 2,
    `Expected at least 2 terminals in snapshot, got ${Object.keys(this.snapshotCols).length}`,
  );
});

Then(
  "the active terminal cols should differ from its snapshot",
  async function (this: KoluWorld) {
    assert.ok(this.snapshotCols, "No snapshot taken");
    const activeId = await visibleTerminalId(this);
    const current = await readAllCols(this);
    const before = this.snapshotCols[activeId];
    const after = current[activeId];
    assert.ok(
      before !== undefined && after !== undefined,
      `Active terminal ${activeId} missing from snapshot or current cols`,
    );
    assert.notStrictEqual(
      after,
      before,
      `Active terminal cols unchanged (${after}); the viewport resize never reached it`,
    );
  },
);

Then(
  "the hidden terminal cols should match its snapshot",
  async function (this: KoluWorld) {
    assert.ok(this.snapshotCols, "No snapshot taken");
    const activeId = await visibleTerminalId(this);
    const current = await readAllCols(this);
    const hiddenIds = Object.keys(this.snapshotCols).filter(
      (id) => id !== activeId,
    );
    assert.ok(
      hiddenIds.length >= 1,
      `Expected at least one hidden terminal, got ${hiddenIds.length}`,
    );
    for (const id of hiddenIds) {
      const before = this.snapshotCols[id];
      const after = current[id];
      assert.strictEqual(
        after,
        before,
        `Hidden terminal ${id} cols drifted: snapshot=${before} → now=${after}. A visible terminal's fit leaked into a hidden terminal's grid — the per-terminal-sovereignty invariant is broken.`,
      );
    }
  },
);
