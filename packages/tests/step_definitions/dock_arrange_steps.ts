/** Steps for the dock-arrange (#2247) surface: reading the arrangement
 *  (the cheap settle-check read of DOM order) and driving real sortable
 *  drags ontop of solid-dnd's PointerSensor activation. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** One repo section, by its canonical git repo name / cwd basename. */
const sectionSelector = (repo: string) => `[data-repo="${repo}"]`;

/** Drive a sortable drag: grip on from → onto the middle of to. Pointer
 *  activation distance is 10 (solid-dnd PointerSensor) — stepped frames. Enjoy
 *  the same layout-translate a user does, tested from DOM. */
async function dragGrip(
  world: KoluWorld,
  fromSelector: string,
  toSelector: string,
): Promise<void> {
  const from = world.page.locator(fromSelector);
  const to = world.page.locator(toSelector);
  await from.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await to.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  assert.ok(fromBox, `${fromSelector} has no bounding box`);
  assert.ok(toBox, `${toSelector} has no bounding box`);
  const cx = fromBox.x + fromBox.width / 2;
  const cy = fromBox.y + fromBox.height / 2;
  const tx = toBox.x + toBox.width / 2;
  const ty = toBox.y + toBox.height / 2;
  await world.page.mouse.move(cx, cy);
  await world.page.mouse.down();
  // Stepped move so PointerSensor's 250ms/distance-10 activation and every
  // intermediate `pointermove` land with real frames.
  await world.page.mouse.move(tx, ty, { steps: 16 });
  await world.page.mouse.up();
  await world.waitForFrame();
}

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
    // The OUTER sortable's grip is the monogram+name pair — the header's own
    // root (its padding/capsule area) is not inside `dragActivators`.
    await dragGrip(
      this,
      `${sectionSelector(a)} [data-testid="dock-section-monogram"]`,
      `${sectionSelector(b)} [data-testid="dock-section-monogram"]`,
    );
  },
);

When(
  "I drag the dock cluster {string} above the dock cluster {string}",
  async function (this: KoluWorld, a: string, b: string) {
    await dragGrip(
      this,
      `.dock-cluster[data-label="${a}"]`,
      `.dock-cluster[data-label="${b}"]`,
    );
  },
);

/** Record the present row order of a cluster to compare after a move. A fresh
 *  terminal appears in the dock as soon as its id exists, but its repo/label
 *  projection takes another tick (`getDisplayInfo`) — wait for the newest
 *  created terminal to be inside SOME section before snapping, so a pending
 *  project cannot slip a row between snapshot and drag. */
When(
  "I snapshot the {string} cluster's rows",
  async function (this: KoluWorld, label: string) {
    const latest = this.createdTerminalIds.at(-1);
    if (latest) {
      await this.page.waitForFunction(
        (id) =>
          document.querySelector(`.dock-cluster [data-terminal-id="${id}"]`) !==
          null,
        latest,
        { timeout: POLL_TIMEOUT },
      );
    }
    const rows = await this.page.evaluate((label) => {
      const el = document.querySelector(`.dock-cluster[data-label="${label}"]`);
      if (!el) throw new Error(`no cluster for label "${label}"`);
      return Array.from(el.querySelectorAll("[data-terminal-id]")).map(
        (row) => row.getAttribute("data-terminal-id") ?? "",
      );
    }, label);
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
    await this.page.waitForFunction(
      (id) => {
        const row = document.querySelector(`[data-terminal-id="${id}"]`);
        const section = row?.closest("[data-repo]");
        if (!section) return false;
        const rows = Array.from(
          section.querySelectorAll("[data-terminal-id]"),
        ).map((el) => el.getAttribute("data-terminal-id") ?? "");
        return rows.length > 0 && rows[rows.length - 1] === id;
      },
      last,
      { timeout: POLL_TIMEOUT },
    );
  },
);
