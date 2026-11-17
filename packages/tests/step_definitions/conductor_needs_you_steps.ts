/** STEPS FOR WORKS AS PLACES AND SUBJECTS — `@` naming a work, the chat
 *  pointed at one work, a wake's reply folded to one line. The work itself is
 *  opened by `conductor_steps.ts`'s "I ask the conductor to open the work …",
 *  which leaves its id on the world (`workId`), so every step here is about
 *  the card the scenario opened. */

import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { openWorkCard, workCard } from "./conductor_steps.ts";

const INPUT = '[data-testid="conductor-input"]';
const SEND = '[data-testid="conductor-send"]';
const MENU_ROW = '[data-testid="conductor-mention-row"]';
const MENTION_CHIP = '[data-testid="conductor-mention-chip"]';
const SCOPE_CHIP = '[data-testid="conductor-scope-chip"]';
const SCOPE_BAR = '[data-testid="chat-scope-bar"]';
const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const USER_ROW = `${TRANSCRIPT} [data-testid="conductor-row"][data-row-kind="user"]`;
const FOLD_LINE = `${TRANSCRIPT} [data-testid="conductor-fold-line"]`;

const workId = (world: KoluWorld): string => {
  const id = world.workId;
  assert.ok(id, "this scenario never opened a work");
  return id;
};

When(
  "I type {string} in the conductor's box",
  async function (this: KoluWorld, text: string) {
    const input = this.page.locator(INPUT);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.click();
    // Typed, not filled: the menu reads the caret, which a keystroke moves.
    await input.pressSequentially(text);
  },
);

Then(
  "the mention menu should offer the work first",
  async function (this: KoluWorld) {
    const first = this.page.locator(MENU_ROW).first();
    await first.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.equal(await first.getAttribute("data-kind"), "work");
    assert.equal(await first.getAttribute("data-work"), workId(this));
  },
);

When("I take the first mention", async function (this: KoluWorld) {
  // Tab accepts the highlighted row — the top one — and can never send.
  await this.page.locator(INPUT).press("Tab");
});

Then(
  "the conductor's box should carry the work as a mention",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${MENTION_CHIP}[data-kind="work"][data-work="${workId(this)}"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I send what is in the conductor's box", async function (this: KoluWorld) {
  await this.page.locator(SEND).click();
});

/** THE CHIP ON THE TURN a message of yours started — the work the message
 *  named, read back off the row kolu-server stored, not off the box. */
Then(
  "my last message should carry the work's chip",
  async function (this: KoluWorld) {
    const id = workId(this);
    await pollFor({
      observe: () =>
        this.page.locator(USER_ROW).evaluateAll((rows, want) => {
          const last = rows.at(-1);
          if (last === undefined) return "no message of yours";
          // The turn's chips are drawn right after the row, on the reply's
          // side of the column.
          const chips = last.nextElementSibling;
          return chips?.getAttribute("data-testid") ===
            "conductor-turn-works" &&
            chips.querySelector(
              `[data-testid="work-chip"][data-work="${want}"]`,
            )
            ? "carried"
            : `chips after it: ${chips?.textContent ?? "(none)"}`;
        }, id),
      isDone: (seen) => seen === "carried",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (seen, ms) =>
        new Error(
          `after ${ms}ms my last message did not carry the work's chip — ${seen}`,
        ),
    });
  },
);

When(
  "I press {string} on the work's card",
  async function (this: KoluWorld, label: string) {
    await openWorkCard(this);
    await workCard(this)
      .locator('[data-testid="work-card-actions"] button', { hasText: label })
      .click();
  },
);

Then("the chat should be about the work", async function (this: KoluWorld) {
  await this.page
    .locator(`${SCOPE_BAR}[data-work="${workId(this)}"]`)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

/** A message of mine, by its words, and whether it is drawn. */
const myMessage = (world: KoluWorld, text: string) =>
  world.page.locator(USER_ROW).filter({ hasText: text }).first();

Then(
  "my message {string} should be out of sight",
  async function (this: KoluWorld, text: string) {
    await myMessage(this, text).waitFor({
      state: "hidden",
      timeout: POLL_TIMEOUT,
    });
  },
);

Then(
  "my message {string} should be in sight",
  async function (this: KoluWorld, text: string) {
    await myMessage(this, text).waitFor({
      state: "visible",
      timeout: POLL_TIMEOUT,
    });
  },
);

Then(
  "the conductor's box should carry the work as the chat's scope",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${SCOPE_CHIP}[data-work="${workId(this)}"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I show the whole chat", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="chat-scope-show-all"]').click();
  await this.page
    .locator(SCOPE_BAR)
    .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
});

/** THE ONE LINE THE NEWEST WAKE'S TURN IS — open or folded, and saying what
 *  its reply opened with. */
async function newestWakeLine(
  world: KoluWorld,
  open: boolean,
  words: string,
): Promise<void> {
  await pollFor({
    observe: () =>
      world.page.locator(FOLD_LINE).evaluateAll((lines) => {
        const last = lines.at(-1);
        return last === undefined
          ? null
          : {
              open: last.hasAttribute("data-open"),
              says: last.textContent ?? "",
            };
      }),
    isDone: (seen) =>
      seen !== null && seen.open === open && seen.says.includes(words),
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (seen, ms) =>
      new Error(
        `after ${ms}ms the newest wake's line was ${JSON.stringify(seen)}, not ${open ? "open" : "folded"} saying ${JSON.stringify(words)}`,
      ),
  });
}

Then(
  "the newest wake's line should be open, saying {string}",
  async function (this: KoluWorld, words: string) {
    await newestWakeLine(this, true, words);
  },
);

Then(
  "the newest wake's line should be folded, saying {string}",
  async function (this: KoluWorld, words: string) {
    await newestWakeLine(this, false, words);
  },
);

When("I open the newest wake's line", async function (this: KoluWorld) {
  await this.page.locator(FOLD_LINE).last().click();
});
