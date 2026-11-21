/**
 * Two pages of the same kolu in one browser — the same origin, so the same
 * `localStorage`, and so one saved record of unread marks per host
 * (`kolu-attention:<host>`) that both pages read and write.
 */

import * as assert from "node:assert";
import { After, Then, When } from "@cucumber/cucumber";
import type { Page } from "playwright";
import { pollFor } from "../support/poll.ts";
import {
  DOCK_ROW_SELECTOR,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const secondPages = new WeakMap<KoluWorld, Page>();

function second(world: KoluWorld): Page {
  const page = secondPages.get(world);
  assert.ok(page, "no second page in this scenario");
  return page;
}

function createdId(world: KoluWorld, index: number): string {
  const id = world.createdTerminalIds[index - 1];
  assert.ok(id, `No terminal created at index ${index} in this scenario`);
  return id;
}

After(async function (this: KoluWorld) {
  await secondPages.get(this)?.close();
});

When("I open a second page of the same kolu", async function (this: KoluWorld) {
  const page = await this.page.context().newPage();
  await page.goto(this.page.url());
  await page
    .locator(DOCK_ROW_SELECTOR)
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  secondPages.set(this, page);
});

/** Waits until terminal N's row in the SECOND page carries (or lacks) the
 *  unread mark. The mark and the page's write of its unread list happen in
 *  one step of the page, so a row that has lost its mark is a page that has
 *  written the list without it. */
Then(
  /^terminal (\d+)'s dock row should (be|not be) unread in the second page$/,
  async function (this: KoluWorld, index: string, how: string) {
    const row = second(this).locator(
      `${DOCK_ROW_SELECTOR}[data-terminal-id="${createdId(this, Number(index))}"][data-unread]`,
    );
    const want = how === "be" ? 1 : 0;
    await pollFor({
      observe: () => row.count(),
      isDone: (count) => count === want,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (count, ms) =>
        new Error(
          `after ${ms}ms terminal ${index}'s row in the second page was ${count === 1 ? "unread" : "not unread"}, wanted it to ${how} unread`,
        ),
    });
  },
);

When(
  "I click terminal {int}'s dock row in the second page",
  async function (this: KoluWorld, index: number) {
    await second(this)
      .locator(
        `${DOCK_ROW_SELECTOR}[data-terminal-id="${createdId(this, index)}"]`,
      )
      .click();
  },
);

/** What THIS BROWSER has saved for the local host — the record both pages
 *  read and write. Terminals by their creation index, comma-separated; `""`
 *  is none. */
Then(
  "this browser's saved unread list should be terminals {string}",
  async function (this: KoluWorld, indexes: string) {
    const expected = indexes
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map((s) => createdId(this, Number(s)))
      .sort();
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const raw = localStorage.getItem("kolu-attention:local");
          if (raw === null) return null;
          const saved: unknown = JSON.parse(raw);
          return saved !== null &&
            typeof saved === "object" &&
            "unread" in saved &&
            Array.isArray(saved.unread)
            ? [...saved.unread].sort()
            : `not an attention record: ${raw}`;
        }),
      isDone: (saved) => JSON.stringify(saved) === JSON.stringify(expected),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (saved, ms) =>
        new Error(
          `after ${ms}ms the saved unread list was ${JSON.stringify(saved)}, wanted ${JSON.stringify(expected)}`,
        ),
    });
  },
);

When("I reload the first page", async function (this: KoluWorld) {
  await this.page.reload();
  await this.page
    .locator(DOCK_ROW_SELECTOR)
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

/** The terminal's row shows padi's verdict that its agent's turn is over —
 *  still, in the post-turn paint — so a check after this one is about what
 *  the page did with padi's word, not a page that has not heard it yet. */
Then(
  "terminal {int}'s dock row should show its finished turn",
  async function (this: KoluWorld, index: number) {
    const id = createdId(this, index);
    await pollFor({
      observe: () =>
        this.page.evaluate((terminal) => {
          const pip = document.querySelector(
            `[data-testid="dock-row"][data-terminal-id="${terminal}"] [data-testid="state-pip"]`,
          );
          return pip === null
            ? "no row"
            : `${pip.getAttribute("data-pip")}/${pip.getAttribute("data-motion")}`;
        }, id),
      isDone: (pip) => pip === "linger/none",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (pip, ms) =>
        new Error(
          `after ${ms}ms terminal ${index}'s row had not shown a finished turn (pip: ${pip})`,
        ),
    });
  },
);

Then(
  "terminal {int}'s dock row should not be unread",
  async function (this: KoluWorld, index: number) {
    // Two frames, so the page has painted whatever its last write decided.
    await this.waitForFrame();
    await this.waitForFrame();
    const unread = await this.page
      .locator(
        `${DOCK_ROW_SELECTOR}[data-terminal-id="${createdId(this, index)}"][data-unread]`,
      )
      .count();
    assert.strictEqual(
      unread,
      0,
      `terminal ${index}'s dock row is unread on the first page`,
    );
  },
);
