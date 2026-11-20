/** THE COMPACTION LINE — step definitions for the one line a compaction is in
 *  the Conductor's chat, the status line while one runs, and the header tip
 *  that names where it happens. The scripted agent's words that drive them
 *  are in `support/acp-fixture-agent.ts`. */

import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const LINE =
  '[data-testid="conductor-transcript"] [data-testid="conductor-compaction"]';

/** The newest compaction line — a scenario is about the one it just made. */
const newest = (world: KoluWorld) => world.page.locator(LINE).last();

/** Wait until `observe` says what `holds` wants, naming `what` on a timeout. */
const until = async (
  what: string,
  observe: () => Promise<string | null>,
  holds: (seen: string | null) => boolean,
): Promise<void> => {
  await pollFor({
    observe,
    isDone: holds,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what}: last saw ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
};

Then(
  "the conductor transcript should show a {string} compaction line",
  async function (this: KoluWorld, state: string) {
    await until(
      "the newest compaction line's state",
      () => newest(this).getAttribute("data-state"),
      (seen) => seen === state,
    );
  },
);

Then(
  "the compaction line should read {string}",
  async function (this: KoluWorld, words: string) {
    await until(
      "the newest compaction line",
      () =>
        newest(this)
          .locator('[data-testid="conductor-compaction-toggle"]')
          .textContent(),
      (seen) => (seen ?? "").toLowerCase().includes(words.toLowerCase()),
    );
  },
);

Then("the compaction line should be folded", async function (this: KoluWorld) {
  await until(
    "the newest compaction line's summary",
    async () =>
      String(
        await newest(this)
          .locator('[data-testid="conductor-compaction-summary"]')
          .isVisible(),
      ),
    (seen) => seen === "false",
  );
});

When("I open the compaction line", async function (this: KoluWorld) {
  await newest(this)
    .locator('[data-testid="conductor-compaction-toggle"]')
    .click();
});

Then(
  "the compaction line should say {string}",
  async function (this: KoluWorld, sentence: string) {
    await until(
      "the newest compaction line's sentence",
      async () => {
        const said = newest(this).locator(
          '[data-testid="conductor-compaction-sentence"]',
        );
        return (await said.isVisible()) ? await said.textContent() : null;
      },
      (seen) => seen === sentence,
    );
  },
);

Then(
  "the compaction line should show the summary {string}",
  async function (this: KoluWorld, summary: string) {
    await until(
      "the newest compaction line's summary",
      async () => {
        const shown = newest(this).locator(
          '[data-testid="conductor-compaction-summary"]',
        );
        return (await shown.isVisible()) ? await shown.textContent() : null;
      },
      (seen) => seen === summary,
    );
  },
);

Then(
  "the conductor status should say it is {string}",
  async function (this: KoluWorld, doing: string) {
    await until(
      "the conductor status line's detail",
      () =>
        this.page
          .locator('[data-testid="conductor-status-detail"]')
          .textContent(),
      (seen) => seen?.trim() === doing,
    );
  },
);

/** HOVERED THE WAY A PERSON HOVERS: the pointer keeps moving over the meter.
 *  The tip opens only for a pointer still inside it when its delay ends, and
 *  it learns that from `pointermove`s after the enter — one `hover()` is a
 *  single move, so the tip would never open. */
const METER = '[data-testid="conductor-usage"]';
let nudge = 0;

When("I hover the conductor's context meter", async function (this: KoluWorld) {
  await this.page.locator(METER).hover();
});

Then(
  "the context meter's tip should say {string}",
  async function (this: KoluWorld, sentence: string) {
    await pollFor({
      onTick: async () => {
        nudge = (nudge + 1) % 4;
        await this.page
          .locator(METER)
          .hover({ position: { x: 4 + nudge, y: 2 } });
      },
      observe: async () => {
        const tip = this.page.locator(
          '[data-testid="conductor-usage-compacts"]',
        );
        return (await tip.isVisible()) ? await tip.textContent() : null;
      },
      isDone: (seen) => seen?.replace(/\s+/g, " ").trim() === sentence,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `the context meter's tip: last saw ${JSON.stringify(last)} after ${elapsedMs}ms`,
        ),
    });
  },
);
