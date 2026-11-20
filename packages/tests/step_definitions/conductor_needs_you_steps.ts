import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import {
  waitForNeedsYouBellVerdict,
  openWorkCard,
  workCard,
} from "./conductor_steps.ts";

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

Then(
  "my last message should carry the work's chip",
  async function (this: KoluWorld) {
    const id = workId(this);
    await pollFor({
      observe: () =>
        this.page.locator(USER_ROW).evaluateAll((rows, want) => {
          const last = rows.at(-1);
          if (last === undefined) return "no message of yours";
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

Then(
  "the work's question should be in the chat, its card shut",
  async function (this: KoluWorld) {
    const question = this.page
      .locator(`${TRANSCRIPT} [data-testid="work-question"][data-from="chat"]`)
      .last();
    await question.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator(
        `[data-testid="work-waiting"] [data-testid="work-card"][data-work="${workId(this)}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForNeedsYouBellVerdict(this);
    assert.equal(
      await workCard(this).getAttribute("data-open"),
      null,
      "the work's card was opened, so the chat's copy is not the only one",
    );
  },
);

async function newestWakeTurn(
  world: KoluWorld,
  open: boolean,
  words: string,
): Promise<void> {
  await pollFor({
    observe: async () => {
      const line = await world.page.locator(FOLD_LINE).evaluateAll((lines) => {
        const last = lines.at(-1);
        return last === undefined
          ? null
          : {
              open: last.hasAttribute("data-open"),
              says: last.textContent ?? "",
            };
      });
      const reply = await world.page
        .locator(
          `${TRANSCRIPT} [data-testid="conductor-row"][data-row-kind="agent"]`,
        )
        .evaluateAll(
          (rows, want) =>
            rows
              .filter((row) => (row.textContent ?? "").includes(want))
              .at(-1)
              ?.checkVisibility() ?? null,
          words,
        );
      return { line, replyShown: reply };
    },
    isDone: ({ line, replyShown }) =>
      line !== null &&
      line.open === open &&
      replyShown === open &&
      line.says.includes(words) === !open,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (seen, ms) =>
      new Error(
        `after ${ms}ms the newest wake's turn was ${JSON.stringify(seen)}, not ${open ? "open with its reply on screen" : `folded to a line saying ${JSON.stringify(words)}`}`,
      ),
  });
}

Then(
  "the newest wake's turn should be open, its reply saying {string} on screen",
  async function (this: KoluWorld, words: string) {
    await newestWakeTurn(this, true, words);
  },
);

Then(
  "the newest wake's turn should be one folded line saying {string}, its reply off screen",
  async function (this: KoluWorld, words: string) {
    await newestWakeTurn(this, false, words);
  },
);

When("I open the newest wake's line", async function (this: KoluWorld) {
  await this.page.locator(FOLD_LINE).last().click();
});
