/** Steps for the dock-arrange (#2247) surface: reading the arrangement
 *  (the cheap settle-check read of DOM order) and driving real sortable
 *  drags ontop of solid-dnd's PointerSensor activation. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { dragCenterTo } from "../support/pointerDrag.ts";
import { padiCall } from "../support/rpcWire.ts";
import {
  type KoluWorld,
  DOCK_ROW_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";

/** One repo section, by its canonical git repo name / cwd basename. */
const sectionSelector = (repo: string) => `[data-repo="${repo}"]`;

Then(
  "the dock should show the {string} repo section",
  async function (this: KoluWorld, repo: string) {
    await this.page
      .locator(sectionSelector(repo))
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the dock should show the {string} cluster",
  async function (this: KoluWorld, label: string) {
    await this.page
      .locator(`.dock-cluster[data-label="${label}"]`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** `before` in DOM order = strictly ABOVE visually (the section list is one
 *  column). Read through the singleton's own projection list, not the screen's
 *  Y — a sticky header in a scrolled position can't lie about it. */
const sectionOrderCheck = async (world: KoluWorld, a: string, b: string) => {
  await world.page.waitForFunction(
    ([a, b]) => {
      const all = Array.from(document.querySelectorAll("[data-repo]")).map(
        (el) => el.getAttribute("data-repo") ?? "",
      );
      const ia = all.indexOf(a);
      const ib = all.indexOf(b);
      return ia !== -1 && ib !== -1 && ia < ib;
    },
    [a, b] as [string, string],
    { timeout: POLL_TIMEOUT },
  );
};

Then(
  "the dock should show {string} before {string}",
  async function (this: KoluWorld, a: string, b: string) {
    await sectionOrderCheck(this, a, b);
  },
);

Then(
  "the dock should still show {string} before {string}",
  async function (this: KoluWorld, a: string, b: string) {
    // After a reload + session restore, the pinned overlay must show through.
    await sectionOrderCheck(this, a, b);
  },
);

Then(
  "the dock should show the {string} cluster before {string}",
  async function (this: KoluWorld, a: string, b: string) {
    await this.page.waitForFunction(
      ([a, b]) => {
        const all = Array.from(
          document.querySelectorAll(".dock-cluster[data-label]"),
        ).map((el) => el.getAttribute("data-label") ?? "");
        const ia = all.indexOf(a);
        const ib = all.indexOf(b);
        return ia !== -1 && ib !== -1 && ia < ib;
      },
      [a, b] as [string, string],
      { timeout: POLL_TIMEOUT },
    );
  },
);

When(
  "I drag the dock section {string} above the dock section {string}",
  async function (this: KoluWorld, a: string, b: string) {
    // The OUTER sortable's grip is the monogram — the header's own root
    // (its padding/capsule area) is not inside `dragActivators`.
    await dragCenterTo(
      this,
      `${sectionSelector(a)} [data-testid="dock-section-monogram"]`,
      `${sectionSelector(b)} [data-testid="dock-section-monogram"]`,
    );
  },
);

When(
  "I drag the dock cluster {string} above the dock cluster {string}",
  async function (this: KoluWorld, a: string, b: string) {
    await dragCenterTo(
      this,
      `.dock-cluster[data-label="${a}"]`,
      `.dock-cluster[data-label="${b}"]`,
    );
  },
);

/** Record the present row order of a cluster to compare after a move. A fresh
 *  terminal's row appears as soon as its id exists, but its repo/label
 *  projection lands in waves (cwd first, git root later) — it can hop
 *  BETWEEN clusters for a beat. A once-read snapshot can latch that beat; so
 *  read the cluster twice, 500 ms apart, and only accept a list that did not
 *  change. */
When(
  "I snapshot the {string} cluster's rows",
  async function (this: KoluWorld, label: string) {
    const readRows = () =>
      this.page.evaluate((label) => {
        const el = document.querySelector(
          `.dock-cluster[data-label="${label}"]`,
        );
        if (!el) throw new Error(`no cluster for label "${label}"`);
        return Array.from(el.querySelectorAll("[data-terminal-id]")).map(
          (row) => row.getAttribute("data-terminal-id") ?? "",
        );
      }, label);
    let rows = await readRows();
    const steadyDeadline = Date.now() + POLL_TIMEOUT;
    for (;;) {
      {
        const { promise, resolve } = Promise.withResolvers<void>();
        setTimeout(resolve, 500);
        await promise;
      }
      const again = await readRows();
      if (JSON.stringify(rows) === JSON.stringify(again)) break;
      assert.ok(
        Date.now() < steadyDeadline,
        `cluster "${label}" rows never settled: ${JSON.stringify(again)}`,
      );
      rows = again;
    }
    this.savedClusterRows.set(label, rows);
  },
);

Then(
  "the {string} cluster rows should match the snapshot",
  async function (this: KoluWorld, label: string) {
    const saved = this.savedClusterRows.get(label);
    assert.ok(saved, `no cluster-snapshot for "${label}"`);
    await this.page
      .waitForFunction(
        ([label, snapshot]) => {
          const el = document.querySelector(
            `.dock-cluster[data-label="${label}"]`,
          );
          if (!el) return false;
          const live = Array.from(
            el.querySelectorAll("[data-terminal-id]"),
          ).map((row) => row.getAttribute("data-terminal-id") ?? "");
          return JSON.stringify(live) === JSON.stringify(snapshot);
        },
        [label, saved] as [string, string[]],
        { timeout: POLL_TIMEOUT },
      )
      .catch(async () => {
        // Read once on timeout so the diff (not just "false") surfaces in the
        // assertion — helpful when a drag unexpectedly reorders rows.
        const live = await this.page.evaluate((label) => {
          const el = document.querySelector(
            `.dock-cluster[data-label="${label}"]`,
          );
          if (!el) return null;
          return Array.from(el.querySelectorAll("[data-terminal-id]")).map(
            (row) => row.getAttribute("data-terminal-id") ?? "",
          );
        }, label);
        assert.deepStrictEqual(
          live,
          saved,
          `cluster "${label}" moved rows it should keep in place`,
        );
      });
  },
);

Then(
  "the new terminal should be the last row of its repo section",
  async function (this: KoluWorld) {
    const last = this.createdTerminalIds.at(-1);
    assert.ok(last, "no created terminal #last to compare");
    // The arrangement law: the new row lands INSIDE its own cluster
    // (creation order appends to the cluster's BOTTOM), and its cluster is
    // where the user put it — never resequenced by the creation. Assert the
    // row's cluster + its position INSIDE that cluster, not a flat last-slot
    // across the whole section: a moved cluster genuinely changes a flat
    // order without touching the law.
    await this.page
      .waitForFunction(
        (id) => {
          const row = document.querySelector(
            `[data-repo] [data-dock-row][data-terminal-id="${id}"]`,
          );
          const cluster = row?.closest("[data-label]");
          if (!cluster) return false;
          const rows = Array.from(
            cluster.querySelectorAll("[data-dock-row][data-terminal-id]"),
          ).map((el) => el.getAttribute("data-terminal-id") ?? "");
          return rows[rows.length - 1] === id;
        },
        last,
        { timeout: POLL_TIMEOUT },
      )
      .catch(async () => {
        // The failure dump the neighbouring cluster-snapshot steps carry:
        // name the shapes the DOM actually shows — per cluster, plus the
        // ACTIVE surface: when the step reds, the reading splits into two
        // truths: the row landed in the WRONG cluster (create inherited an
        // unexpected cwd), or it landed last in the WRONG ORDER — and the
        // dump must show which without a second round-trip.
        const live = await this.page.evaluate(() => ({
          clusters: Array.from(
            document.querySelectorAll("[data-repo] [data-label]"),
          ).map((cluster) => ({
            label: cluster.getAttribute("data-label"),
            rows: Array.from(
              cluster.querySelectorAll("[data-dock-row][data-terminal-id]"),
            ).map((el) => el.getAttribute("data-terminal-id") ?? ""),
          })),
          activeDockRow: document
            .querySelector("[data-repo] [data-dock-row][data-active]")
            ?.getAttribute("data-terminal-id"),
          activeCanvas: Array.from(
            document.querySelectorAll(
              "[data-canvas-tile][data-active] [data-terminal-id]",
            ),
          ).map((el) => el.getAttribute("data-terminal-id") ?? ""),
        }));
        assert.fail(
          `newest terminal never landed at its cluster's bottom: ${JSON.stringify(live)}`,
        );
      });
  },
);

/* ── Drag a row to RE-HOME it (nest it, or hand it back its own tile) ──────
 *  The gesture is the row's own GRIP, not its body: a pointerdown on the body
 *  still reaches the branch cluster's activator (#2249's reorder), which is
 *  exactly why the grip stops the event at the row's boundary. */

/** The dock row of a terminal created in this scenario, by 1-based creation
 *  index — the addressing the workspace-switcher steps already use. */
const createdRowSelector = (world: KoluWorld, index: number): string => {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index} in this scenario`);
  return `${DOCK_ROW_SELECTOR}[data-terminal-id="${id}"]`;
};

/** Drag a row by its grip. The grip is revealed on hover and takes no pointer
 *  events until it is, so the row is hovered FIRST — otherwise the press lands
 *  on the row body and reorders the cluster instead of re-homing the terminal. */
const dragRowGrip = async (
  world: KoluWorld,
  fromRow: string,
  to: string,
): Promise<void> => {
  await world.page.locator(fromRow).hover();
  await dragCenterTo(world, `${fromRow} [data-testid="dock-row-grip"]`, to);
};

When(
  "I drag the dock row of terminal {int} onto the dock row of terminal {int}",
  async function (this: KoluWorld, from: number, to: number) {
    await dragRowGrip(
      this,
      createdRowSelector(this, from),
      createdRowSelector(this, to),
    );
  },
);

When(
  "I drag the split's dock row onto the {string} repo header",
  async function (this: KoluWorld, repo: string) {
    const subId = this.rememberedSubTerminalId;
    assert.ok(
      subId,
      'no remembered sub-terminal — call "I remember the sub-terminal\'s id" first',
    );
    await dragRowGrip(
      this,
      `[data-testid="dock-sub-row"][data-terminal-id="${subId}"]`,
      `${sectionSelector(repo)} [data-testid="dock-header-drop"]`,
    );
  },
);

When("I split terminal {int}", async function (this: KoluWorld, index: number) {
  const parentId = this.createdTerminalIds[index - 1];
  assert.ok(parentId, `No terminal created at index ${index} in this scenario`);
  // Through the daemon, not the product's palette path: the palette's first
  // click lands on the terminal screen, and a link under the cursor flips
  // xterm's link layer over that screen — a non-deterministic target for a
  // scenario that is about the DOCK's drag, not about how a split is born.
  // (`sub-terminal.feature` owns the palette path.)
  await padiCall("lifecycle/create", {
    placement: { kind: "child-of", parentId },
  });
  await this.page
    .locator('[data-testid="dock-sub-row"]')
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "terminal {int} should be a split of terminal {int} in the dock",
  async function (this: KoluWorld, childIndex: number, parentIndex: number) {
    const child = this.createdTerminalIds[childIndex - 1];
    const parent = this.createdTerminalIds[parentIndex - 1];
    assert.ok(
      child && parent,
      `No terminals created at indices ${childIndex} / ${parentIndex}`,
    );
    await this.page
      .locator(
        `[data-testid="dock-sub-row"][data-terminal-id="${child}"][data-parent-id="${parent}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT })
      .catch(async () => {
        // Dump the whole dock's row shape: "not a split of X" cannot tell an
        // unchanged dock from one that nested under the WRONG parent, and the
        // two need different fixes.
        const shape = await this.page.evaluate(() => ({
          rows: Array.from(document.querySelectorAll("[data-dock-row]")).map(
            (el) => ({
              testid: el.getAttribute("data-testid"),
              id: el.getAttribute("data-terminal-id"),
              parent: el.getAttribute("data-parent-id"),
              drop: el.getAttribute("data-drop"),
            }),
          ),
          grips: document.querySelectorAll('[data-testid="dock-row-grip"]')
            .length,
        }));
        assert.fail(
          `terminal ${child} is not a split of ${parent}: ${JSON.stringify(shape)}`,
        );
      });
  },
);

Then(
  "the split should have its own dock row",
  async function (this: KoluWorld) {
    const subId = this.rememberedSubTerminalId;
    assert.ok(subId, "no remembered sub-terminal id");
    // A top-level row: it wears the top-level test id and carries NO parent edge.
    await this.page
      .locator(
        `${DOCK_ROW_SELECTOR}[data-terminal-id="${subId}"]:not([data-parent-id])`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** The canvas's tile count, read off the DOM — the arrangement fact a re-home
 *  changes (a nested row's tile goes away; an un-split row's comes back). */
const canvasTileCount = (world: KoluWorld): Promise<number> =>
  world.page.evaluate(
    () => document.querySelectorAll("[data-canvas-tile]").length,
  );

When("I remember the canvas tile count", async function (this: KoluWorld) {
  this.canvasTileCount = await canvasTileCount(this);
});

/** Assert the canvas moved by `delta` from the remembered count. Relative on
 *  purpose: the scenario's own background terminal is a tile too. */
const expectTileDelta = async (world: KoluWorld, delta: number) => {
  const before = world.canvasTileCount;
  assert.ok(before !== null, 'call "I remember the canvas tile count" first');
  const expected = before + delta;
  await world.page
    .waitForFunction(
      (n) => document.querySelectorAll("[data-canvas-tile]").length === n,
      expected,
      { timeout: POLL_TIMEOUT },
    )
    .catch(async () => {
      const tiles = await world.page.evaluate(() =>
        Array.from(document.querySelectorAll("[data-canvas-tile]")).map(
          (el) => el.getAttribute("data-terminal-id") ?? "",
        ),
      );
      assert.fail(
        `expected ${expected} canvas tiles (${before} ${delta >= 0 ? "+" : ""}${delta}), found ${tiles.length}: ${JSON.stringify(tiles)}`,
      );
    });
};

Then(
  "the canvas tile count should drop by {int}",
  async function (this: KoluWorld, delta: number) {
    await expectTileDelta(this, -delta);
  },
);

Then(
  "the canvas tile count should rise by {int}",
  async function (this: KoluWorld, delta: number) {
    await expectTileDelta(this, delta);
  },
);
