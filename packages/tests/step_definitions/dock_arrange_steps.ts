/** Steps for the dock-arrange (#2247) surface: reading the arrangement
 *  (the cheap settle-check read of DOM order) and driving real sortable
 *  drags ontop of solid-dnd's PointerSensor activation. */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { dragCenterTo } from "../support/pointerDrag.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

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
