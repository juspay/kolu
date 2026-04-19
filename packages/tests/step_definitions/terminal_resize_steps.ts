import { When, Then } from "@cucumber/cucumber";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import * as assert from "node:assert";

/** Read cols from every terminal's live xterm via the __xterm ref we
 *  attach in Terminal.tsx's onMount. Keyed by the element's
 *  data-terminal-id so callers can match hidden vs. visible later.
 *  Filters to inner terminal containers (those with data-font-size) —
 *  the outer CanvasTile wrapper also carries data-terminal-id but
 *  never holds __xterm. */
async function readAllCols(world: KoluWorld): Promise<Record<string, number>> {
  return world.page.evaluate(() => {
    const out: Record<string, number> = {};
    const nodes = document.querySelectorAll(
      "[data-terminal-id][data-font-size]",
    );
    for (const n of nodes) {
      const id = n.getAttribute("data-terminal-id");
      const term = (n as unknown as { __xterm?: { cols: number } }).__xterm;
      if (id && term && typeof term.cols === "number") out[id] = term.cols;
    }
    return out;
  });
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
        if (!term || !term.cols) return false;
      }
      return true;
    },
    { timeout: POLL_TIMEOUT },
  );
});

When(
  "I wait for the active terminal to refit",
  async function (this: KoluWorld) {
    // "Settle" alone isn't enough after a viewport resize: the previous
    // cols are already non-zero, so a bare non-zero check passes before
    // debouncedFit()'s rAF has run. Wait until the visible terminal's
    // cols actually changes relative to the stashed snapshot.
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
        if (!id || !term || !term.cols) return false;
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
