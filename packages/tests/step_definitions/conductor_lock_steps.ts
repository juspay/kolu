import assert from "node:assert";
import { After, Then, When } from "@cucumber/cucumber";
import type { BrowserContext, Locator, Page } from "playwright";
import { OMP_HEARD_MARKER, OMP_UP_MARKER } from "../support/agent-mock-omp.ts";
import { readBufferText } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const LOCK = '[data-testid="work-lock"]';
const CARD = '[data-testid="work-lock-card"]';
const PILL = '[data-testid="work-hand-back"]';
const MARK = '[data-testid="work-mark"]';
const ROW_NAME = '[data-testid="dock-row-name"]';

const BLOCKED_WINDOW_MS = 3_000;

function memberId(world: KoluWorld): string {
  const id = world.watchedTerminalId ?? world.memberTerminalId;
  assert.ok(id, "no terminal was put into a piece of work in this scenario");
  return id;
}

function memberTerminalBody(world: KoluWorld): string {
  return `[data-terminal-id="${memberId(world)}"][data-font-size]`;
}

function lockPart(world: KoluWorld, testid: string, page?: Page): Locator {
  return (page ?? world.page).locator(
    `${testid}[data-lock-terminal$="/${memberId(world)}"]`,
  );
}

async function memberScreen(world: KoluWorld): Promise<string> {
  return readBufferText(world.page, memberTerminalBody(world));
}

let notedScreen: string | null = null;

let secondClient: { context: BrowserContext; page: Page } | null = null;

After(async () => {
  notedScreen = null;
  if (secondClient) {
    await secondClient.context.close().catch(() => undefined);
    secondClient = null;
  }
});

When("I go to the member terminal", async function (this: KoluWorld) {
  const id = memberId(this);
  await this.page
    .locator(
      `[data-testid="work-column"] [data-testid="work-member"][data-ref$="/${id}"] [data-testid="work-member-name"]`,
    )
    .click();
  await pollFor({
    observe: () =>
      this.page.evaluate(() => {
        const at = document.querySelector(
          '[data-testid="canvas-tile"][data-active], [data-mobile-tile][data-active]',
        );
        return (
          at?.getAttribute("data-terminal-id") ??
          at?.getAttribute("data-mobile-tile") ??
          "none"
        );
      }),
    isDone: (seen) => seen === id,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `pressing the member's name never landed on its terminal after ${ms}ms; the terminal on screen was ${JSON.stringify(last)}`,
      ),
  });
});

async function expectFrame(
  world: KoluWorld,
  driver: "conductor" | "you",
): Promise<void> {
  const frame = lockPart(world, LOCK);
  await frame.first().waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  await pollFor({
    observe: async () =>
      (await frame.first().getAttribute("data-driver")) ?? "absent",
    isDone: (seen) => seen === driver,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `the terminal's frame still reads ${JSON.stringify(last)} rather than ${JSON.stringify(driver)} after ${ms}ms`,
      ),
  });
}

Then(
  "the member terminal should be framed as driven by the Conductor",
  async function (this: KoluWorld) {
    await expectFrame(this, "conductor");
  },
);

Then(
  "the member terminal should be framed as yours",
  async function (this: KoluWorld) {
    await expectFrame(this, "you");
  },
);

Then(
  "the member terminal should offer to hand back",
  async function (this: KoluWorld) {
    const pill = lockPart(this, PILL).first();
    await pill.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const reads = ((await pill.textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    assert.ok(
      reads.includes("You’re driving") && reads.includes("Hand back"),
      `the pill reads ${JSON.stringify(reads)}, which does not say you are driving and offer to hand it back`,
    );
  },
);

Then(
  "the lock card should offer to take over the {string}",
  async function (this: KoluWorld, role: string) {
    const card = lockPart(this, CARD).first();
    await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const reads = ((await card.textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    assert.ok(
      reads.includes(`The Conductor is driving this terminal · ${role}`),
      `the card reads ${JSON.stringify(reads)}, which does not name the Conductor and the ${role}`,
    );
    await card
      .locator('[data-testid="work-take-over"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the lock card should sit over the member terminal",
  async function (this: KoluWorld) {
    const card = await lockPart(this, CARD).first().boundingBox();
    const body = await this.page
      .locator(memberTerminalBody(this))
      .first()
      .boundingBox();
    assert.ok(card && body, "the card or the terminal has no box on screen");
    assert.ok(
      card.x >= body.x - 1 &&
        card.y >= body.y - 1 &&
        card.x + card.width <= body.x + body.width + 1 &&
        card.y + card.height <= body.y + body.height + 1,
      `the card (${JSON.stringify(card)}) is not over the terminal (${JSON.stringify(body)})`,
    );
  },
);

Then(
  "the member terminal should have no lock card",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () => lockPart(this, CARD).count(),
      isDone: (count) => count === 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, ms) =>
        new Error(`the card was still up ${ms}ms later`),
    });
  },
);

When("the lock card goes by itself", async function (this: KoluWorld) {
  await pollFor({
    observe: () => lockPart(this, CARD).count(),
    isDone: (count) => count === 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (_last, ms) =>
      new Error(`the card never went by itself; still up ${ms}ms later`),
  });
});

When("I take over the member terminal", async function (this: KoluWorld) {
  const card = lockPart(this, CARD);
  if ((await card.count()) === 0) {
    await this.focusForTyping(`[data-terminal-id="${memberId(this)}"]`);
    await this.page.keyboard.type("k");
    await card.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  }
  await card.first().locator('[data-testid="work-take-over"]').click();
});

When("I hand the member terminal back", async function (this: KoluWorld) {
  await lockPart(this, PILL).first().click();
});

When(
  "I type {string} into the member terminal",
  async function (this: KoluWorld, text: string) {
    await this.focusForTyping(`[data-terminal-id="${memberId(this)}"]`);
    await this.page.keyboard.type(text);
    await this.page.keyboard.press("Enter");
  },
);

When(
  "I paste {string} into the member terminal",
  async function (this: KoluWorld, text: string) {
    await this.page.evaluate(
      (value) => navigator.clipboard.writeText(value),
      text,
    );
    await this.focusForTyping(`[data-terminal-id="${memberId(this)}"]`);
    await this.page.keyboard.press(`${MOD_KEY}+KeyV`);
  },
);

Then(
  "the member terminal should have come up",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () => memberScreen(this),
      isDone: (screen) => screen.includes(OMP_UP_MARKER),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the member terminal's stand-in never came up after ${ms}ms; its screen tail reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

Then(
  "the member terminal should have heard {string}",
  async function (this: KoluWorld, text: string) {
    await pollFor({
      observe: () => memberScreen(this),
      isDone: (screen) => screen.includes(`${OMP_HEARD_MARKER} ${text}`),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the member terminal never heard ${JSON.stringify(text)} after ${ms}ms; its screen tail reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

Then(
  "the member terminal should not have heard {string}",
  async function (this: KoluWorld, text: string) {
    const deadline = Date.now() + BLOCKED_WINDOW_MS;
    for (;;) {
      const screen = await memberScreen(this);
      if (screen.includes(text)) {
        throw new Error(
          `the lock let ${JSON.stringify(text)} through; the member terminal's screen tail reads ${JSON.stringify(screen.trim().slice(-300))}`,
        );
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },
);

Then(
  "selecting text in the member terminal should still work",
  async function (this: KoluWorld) {
    const screen = this.page
      .locator(`[data-terminal-id="${memberId(this)}"] .xterm-screen`)
      .first();
    const box = await screen.boundingBox();
    assert.ok(box, "the member terminal has no box on screen to select in");
    const written = await this.page.evaluate((sel) => {
      const node = document.querySelector(sel) as
        | (HTMLElement & {
            __xterm?: {
              rows: number;
              buffer: {
                active: {
                  viewportY: number;
                  getLine(
                    at: number,
                  ): { translateToString(t: boolean): string } | undefined;
                };
              };
            };
          })
        | null;
      const term = node?.__xterm;
      if (!term) return null;
      const buffer = term.buffer.active;
      for (let row = 0; row < term.rows; row += 1) {
        const line = buffer.getLine(buffer.viewportY + row);
        if ((line?.translateToString(true) ?? "").trim() !== "")
          return { row, rows: term.rows };
      }
      return null;
    }, memberTerminalBody(this));
    assert.ok(
      written,
      "the member terminal's screen holds no text to select — nothing here could tell a blocked drag from an empty one",
    );
    const rowHeight = box.height / written.rows;
    const y = box.y + (written.row + 0.5) * rowHeight;
    await this.page.mouse.move(box.x + 4, y);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width - 8, y, { steps: 12 });
    await this.page.mouse.up();
    const selection = await this.page.evaluate((sel) => {
      const node = document.querySelector(sel) as
        | (HTMLElement & { __xterm?: { getSelection(): string } })
        | null;
      return node?.__xterm?.getSelection() ?? "";
    }, memberTerminalBody(this));
    assert.ok(
      selection.trim().length > 0,
      "dragging across a driven terminal selected nothing — the lock reached reading, which it must not",
    );
  },
);

const QUIET_MS = 750;

async function waitForNonEmptyQuietScreen(world: KoluWorld): Promise<string> {
  let last = await memberScreen(world);
  const deadline = Date.now() + POLL_TIMEOUT;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    const now = await memberScreen(world);
    if (now === last && now.trim() !== "") return now;
    if (Date.now() > deadline) {
      throw new Error(
        now.trim() === ""
          ? `the member terminal's screen is still empty after ${POLL_TIMEOUT}ms, so there is nothing to compare against`
          : `the member terminal never stopped printing, so nothing here is a baseline; its screen tail reads ${JSON.stringify(now.trim().slice(-300))}`,
      );
    }
    last = now;
  }
}

When("I note the member terminal's screen", async function (this: KoluWorld) {
  notedScreen = await waitForNonEmptyQuietScreen(this);
});

function noted(): string {
  assert.ok(notedScreen !== null, "this scenario never noted a screen");
  return notedScreen;
}

Then(
  "the member terminal's screen should be unchanged",
  async function (this: KoluWorld) {
    const before = noted();
    const deadline = Date.now() + BLOCKED_WINDOW_MS;
    for (;;) {
      const now = await memberScreen(this);
      if (now !== before) {
        throw new Error(
          `the key reached the PTY: the member terminal's screen tail now reads ${JSON.stringify(now.trim().slice(-300))}`,
        );
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },
);

Then(
  "the member terminal's screen should have changed",
  async function (this: KoluWorld) {
    const before = noted();
    await pollFor({
      observe: () => memberScreen(this),
      isDone: (now) => now !== before,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `nothing reached the PTY after ${ms}ms; the member terminal's screen tail still reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

function dockRow(world: KoluWorld): string {
  return `[data-testid="dock-row"][data-terminal-id="${memberId(world)}"]`;
}

Then(
  "the dock row for the member terminal should be marked as yours",
  async function (this: KoluWorld) {
    const mark = this.page.locator(`${dockRow(this)} ${MARK}`);
    await mark.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await pollFor({
      observe: async () => (await mark.getAttribute("data-driver")) ?? "absent",
      isDone: (seen) => seen === "you",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the dock row's mark still reads driver ${JSON.stringify(last)} after ${ms}ms`,
        ),
    });
  },
);

Then(
  "the dock row's mark should not cover its name",
  async function (this: KoluWorld) {
    const row = dockRow(this);
    const mark = await this.page.locator(`${row} ${MARK}`).boundingBox();
    const name = await this.page.locator(`${row} ${ROW_NAME}`).boundingBox();
    assert.ok(mark && name, "the dock row shows no name beside its mark");
    assert.ok(
      name.width > 0,
      "the dock row's name has no width left — the mark took the row",
    );
    const overlaps =
      mark.x < name.x + name.width &&
      name.x < mark.x + mark.width &&
      mark.y < name.y + name.height &&
      name.y < mark.y + mark.height;
    assert.ok(
      !overlaps,
      `the mark (${JSON.stringify(mark)}) is drawn over the row's name (${JSON.stringify(name)})`,
    );
  },
);

Then(
  "the dock row for the member terminal should carry the work's mark",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${dockRow(this)} ${MARK}`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the member terminal should have no lock",
  async function (this: KoluWorld) {
    const count = await lockPart(this, LOCK).count();
    assert.equal(
      count,
      0,
      "a terminal no waterfall drives is wearing the Conductor's frame",
    );
  },
);

When(
  "I open a second client on the same server",
  async function (this: KoluWorld) {
    const origin = new URL(this.page.url()).origin;
    const context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 },
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    secondClient = { context, page };
    await page.goto(origin);
    await lockPart(this, LOCK, page)
      .first()
      .waitFor({ state: "attached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the second client should show the member terminal as driven by the Conductor",
  async function (this: KoluWorld) {
    await expectSecondDriver(this, "conductor");
  },
);

Then(
  "the second client should show the member terminal as yours",
  async function (this: KoluWorld) {
    await expectSecondDriver(this, "you");
  },
);

async function expectSecondDriver(
  world: KoluWorld,
  driver: "conductor" | "you",
): Promise<void> {
  assert.ok(secondClient, "this scenario never opened a second client");
  const frame = lockPart(world, LOCK, secondClient.page);
  await pollFor({
    observe: async () =>
      (await frame.first().getAttribute("data-driver")) ?? "absent",
    isDone: (seen) => seen === driver,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `the other browser still reads driver ${JSON.stringify(last)} rather than ${JSON.stringify(driver)} after ${ms}ms`,
      ),
  });
}
