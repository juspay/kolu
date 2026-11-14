/** THE LOCK — step definitions for a terminal the Conductor drives.
 *
 *  A member of a waterfall is READ-ONLY to the person until they take it
 *  over, and these steps say that where it can be seen from outside: the
 *  banner in the tile's title area, and the PTY itself.
 *
 *  THE PROBE IS THE PTY, not a signal in the browser. The member terminal the
 *  Conductor starts runs the omp stand-in, whose read loop ECHOES every line
 *  it is given behind a marker it assembles at runtime
 *  (`support/agent-mock-omp.ts`) — so a keystroke that arrived is a line on
 *  the terminal's own screen, and a keystroke the lock swallowed leaves that
 *  screen with no trace of the word at all (an unblocked key would show up
 *  twice: the PTY's echo of what was typed and the stand-in's answer). The
 *  marker is never typed, so nothing a step sends can spell the thing it
 *  waits for.
 *
 *  The arrangement — a repo, a work, its one question, the implementor — is
 *  `conductor_steps.ts`'s; every step here is about a terminal some earlier
 *  step put into a piece of work. */

import assert from "node:assert";
import { After, Then, When } from "@cucumber/cucumber";
import type { BrowserContext, Page } from "playwright";
import { OMP_HEARD_MARKER } from "../support/agent-mock-omp.ts";
import { readBufferText } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

const LOCK = '[data-testid="work-lock"]';
const NUDGE = '[data-testid="work-lock-nudge"]';
const MARK = '[data-testid="work-mark"]';
const CANVAS_TILE = '[data-testid="canvas-tile"]';
const WORK_COLUMN = '[data-testid="work-column"]';

/** How long a BLOCKED input is watched before the claim is made. The guard
 *  answers synchronously, but a keystroke that slipped past it would take a
 *  round trip to the PTY and back to show up — so the negative is only worth
 *  anything if it is held open longer than that trip. */
const BLOCKED_WINDOW_MS = 3_000;

/** The terminal this scenario put into a piece of work — set by the steps
 *  that make a member (`run the implementor …`) or adopt one (`watch …`). */
function memberId(world: KoluWorld): string {
  const id = world.watchedTerminalId ?? world.memberTerminalId;
  assert.ok(id, "no terminal was put into a piece of work in this scenario");
  return id;
}

/** The INNER terminal container — the one that holds the `__xterm` ref and
 *  whose buffer is the PTY's own output (the outer tile wrapper carries the
 *  id but no font size and no terminal). */
function memberTerminal(world: KoluWorld): string {
  return `[data-terminal-id="${memberId(world)}"][data-font-size]`;
}

/** The member's lock banner, wherever this surface draws it: a pill in the
 *  canvas tile's title bar, or — on a phone, which has no canvas and one
 *  terminal on screen — its own band above the key bar. The scoped form is
 *  preferred so a desktop with several tiles cannot read another tile's
 *  banner. */
async function lockBanner(world: KoluWorld) {
  const tiles = await world.page.locator(CANVAS_TILE).count();
  if (tiles === 0) return world.page.locator(LOCK);
  return world.page.locator(
    `${CANVAS_TILE}[data-terminal-id="${memberId(world)}"] ${LOCK}`,
  );
}

async function memberScreen(world: KoluWorld): Promise<string> {
  return readBufferText(world.page, memberTerminal(world));
}

/** The screen a `… should be unchanged` claim is measured against. Module
 *  state, reset per scenario, for the same reason the work fixtures are. */
let notedScreen: string | null = null;

/** The other browser on the same server. Its own context, so it shares
 *  nothing with the first but the server — which is the whole claim. */
let secondClient: { context: BrowserContext; page: Page } | null = null;

After(async () => {
  notedScreen = null;
  if (secondClient) {
    await secondClient.context.close().catch(() => undefined);
    secondClient = null;
  }
});

/** THE WAY TO THE TERMINAL a work made, as a person takes it: the member's
 *  name on the card, which leaves the conversation for the host the terminal
 *  lives on and focuses it. Waited for, because every step below types at
 *  that terminal — on a phone the tile is the one screen, on a desktop it is
 *  the active canvas tile. */
When("I go to the member terminal", async function (this: KoluWorld) {
  const id = memberId(this);
  await this.page
    .locator(
      `${WORK_COLUMN} [data-testid="work-member"][data-ref$="/${id}"] [data-testid="work-member-name"]`,
    )
    .click();
  await pollFor({
    observe: () =>
      this.page.evaluate(() => {
        // A desktop names the active tile on the canvas wrapper; a phone
        // shows one terminal and names it on its own tile. Either way the
        // answer is which terminal the keyboard is about to reach.
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

/** WHO DRIVES IT, read off the banner's own data and its own sentence: the
 *  attribute is what the guard reads, the words are what the person reads,
 *  and a surface where those two disagree is the bug this asserts against. */
async function expectBanner(
  world: KoluWorld,
  driver: "conductor" | "you",
  words: string,
): Promise<void> {
  const banner = await lockBanner(world);
  await banner.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await pollFor({
    observe: async () =>
      (await banner.first().getAttribute("data-driver")) ?? "absent",
    isDone: (seen) => seen === driver,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `the lock still reads ${JSON.stringify(last)} rather than ${JSON.stringify(driver)} after ${ms}ms`,
      ),
  });
  const reads = ((await banner.first().textContent()) ?? "")
    .replace(/\s+/g, " ")
    .trim();
  assert.ok(
    reads.includes(words),
    `the lock reads ${JSON.stringify(reads)}, which does not say ${JSON.stringify(words)}`,
  );
}

Then(
  "the member terminal should say the Conductor drives the {string}",
  async function (this: KoluWorld, role: string) {
    const title = this.workTitle;
    assert.ok(title, "this scenario never named its work");
    await expectBanner(
      this,
      "conductor",
      `Driven by the Conductor · ${role} · ${title}`,
    );
  },
);

Then(
  "the member terminal should say you took over the {string}",
  async function (this: KoluWorld, role: string) {
    const title = this.workTitle;
    assert.ok(title, "this scenario never named its work");
    await expectBanner(this, "you", `Taken over · ${role} · ${title}`);
  },
);

When("I take over the member terminal", async function (this: KoluWorld) {
  const banner = await lockBanner(this);
  await banner.first().locator('[data-testid="work-take-over"]').click();
});

When("I hand the member terminal back", async function (this: KoluWorld) {
  const banner = await lockBanner(this);
  await banner.first().locator('[data-testid="work-hand-back"]').click();
});

/** THE KEYBOARD, at the terminal itself. `focusForTyping` is the harness's
 *  stand-in for a tap on touch and a no-op where the tile already holds
 *  focus; the keys then travel xterm's `onData` — the person-input site the
 *  lock gates — rather than any path a test invented. */
When(
  "I type {string} into the member terminal",
  async function (this: KoluWorld, text: string) {
    await this.focusForTyping(`[data-terminal-id="${memberId(this)}"]`);
    await this.page.keyboard.type(text);
    await this.page.keyboard.press("Enter");
  },
);

/** PASTE, the other half of `onData`: a real clipboard and a real paste
 *  shortcut, so the browser fires the paste event production reads. */
When(
  "I paste {string} into the member terminal",
  async function (this: KoluWorld, text: string) {
    await this.page.evaluate(
      (value) => navigator.clipboard.writeText(value),
      text,
    );
    await this.page
      .locator(`[data-terminal-id="${memberId(this)}"] .xterm-screen`)
      .first()
      .click();
    await this.page.keyboard.press(`${MOD_KEY}+v`);
    await this.waitForFrame();
  },
);

Then(
  "the member terminal should have heard {string}",
  async function (this: KoluWorld, text: string) {
    const want = `${OMP_HEARD_MARKER} ${text}`;
    await pollFor({
      observe: () => memberScreen(this),
      isDone: (screen) => screen.includes(want),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the member terminal never answered ${JSON.stringify(want)} after ${ms}ms; its screen tail reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

/** NOT A TRACE OF IT. Stronger than "the stand-in did not answer": the word
 *  must not be on the screen at all, so a keystroke that reached the PTY and
 *  was merely echoed back fails here too. Held open past a round trip, and
 *  the same probe answers positively one step later in the take-over
 *  scenario — which is what says this watch can see anything. */
Then(
  "the member terminal should not have heard {string}",
  async function (this: KoluWorld, text: string) {
    const deadline = Date.now() + BLOCKED_WINDOW_MS;
    for (;;) {
      const screen = await memberScreen(this);
      if (screen.includes(text)) {
        throw new Error(
          `the lock let ${JSON.stringify(text)} through: the member terminal's screen tail reads ${JSON.stringify(screen.trim().slice(-300))}`,
        );
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },
);

Then("the lock should nudge", async function (this: KoluWorld) {
  const banner = await lockBanner(this);
  const nudge = banner.first().locator(NUDGE);
  await nudge.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const reads = ((await nudge.textContent()) ?? "").replace(/\s+/g, " ").trim();
  assert.ok(
    reads.includes("Take over"),
    `the nudge reads ${JSON.stringify(reads)}, which does not point at Take over`,
  );
});

/** The nudge is a BRIEF thing — it goes by itself, which is also what lets a
 *  later blocked input raise one that means something. */
When("the lock stops nudging", async function (this: KoluWorld) {
  const banner = await lockBanner(this);
  await pollFor({
    observe: () => banner.first().locator(NUDGE).count(),
    isDone: (count) => count === 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (_last, ms) =>
      new Error(`the lock's nudge was still up ${ms}ms later`),
  });
});

/** READING IS UNTOUCHED. A drag across the terminal selects, exactly as it
 *  does on any other terminal — the lock is about input alone, and a tile a
 *  person cannot even copy out of would be a different (and worse) product. */
Then(
  "selecting text in the member terminal should still work",
  async function (this: KoluWorld) {
    const screen = this.page
      .locator(`[data-terminal-id="${memberId(this)}"] .xterm-screen`)
      .first();
    const box = await screen.boundingBox();
    assert.ok(box, "the member terminal has no box on screen to select in");
    await this.page.mouse.move(box.x + 4, box.y + 4);
    await this.page.mouse.down();
    await this.page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, {
      steps: 12,
    });
    await this.page.mouse.up();
    const selection = await this.page.evaluate((sel) => {
      const node = document.querySelector(sel) as
        | (HTMLElement & { __xterm?: { getSelection(): string } })
        | null;
      return node?.__xterm?.getSelection() ?? "";
    }, memberTerminal(this));
    assert.ok(
      selection.trim().length > 0,
      "dragging across a driven terminal selected nothing — the lock reached reading, which it must not",
    );
  },
);

/** How long the screen must hold still before it counts as a baseline. */
const QUIET_MS = 750;

When("I note the member terminal's screen", async function (this: KoluWorld) {
  // A SCREEN STILL FILLING IS NOT A BASELINE. The terminal this claim is
  // about was started moments ago by the conversation, and its own first
  // lines — the command bash echoes, the stand-in's up marker — are still
  // arriving; a snapshot taken mid-arrival reads the next of them as the
  // keystroke that was supposed to be blocked. So wait until two readings a
  // beat apart agree, and note THAT.
  let last = await memberScreen(this);
  const deadline = Date.now() + POLL_TIMEOUT;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    const now = await memberScreen(this);
    if (now === last) {
      notedScreen = now;
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `the member terminal never stopped printing, so nothing here is a baseline; its screen tail reads ${JSON.stringify(now.trim().slice(-300))}`,
      );
    }
    last = now;
  }
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

/** THE MARK OUTSIDE THE PANE carries the driver too — the dock is where a
 *  person looks to see what is happening across the fleet, and a terminal
 *  they took over has to read as theirs there. */
Then(
  "the dock row for the member terminal should be marked as yours",
  async function (this: KoluWorld) {
    const mark = this.page.locator(
      `[data-testid="dock-row"][data-terminal-id="${memberId(this)}"] ${MARK}`,
    );
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
  "the member terminal should carry the work's mark",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${CANVAS_TILE}[data-terminal-id="${memberId(this)}"] ${MARK}`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** NOTHING DRIVES IT. Said about a tile whose mark is already on screen (the
 *  step above), so this cannot pass by looking at a terminal that is not
 *  there. */
Then(
  "the member terminal should have no lock",
  async function (this: KoluWorld) {
    const count = await this.page
      .locator(`${CANVAS_TILE}[data-terminal-id="${memberId(this)}"] ${LOCK}`)
      .count();
    assert.equal(
      count,
      0,
      "a terminal no waterfall drives is wearing the Conductor's lock",
    );
  },
);

/** A SECOND BROWSER on the same server — its own context, so it shares
 *  nothing with the first but the server it dials. It is given no gesture
 *  after it loads: every claim about it below is about a frame the server
 *  pushed. */
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
    // PROVE IT IS REALLY UP, and on the terminal in question: a client still
    // hydrating has no tile at all, and every assertion below would read its
    // absence as a lock that never moved.
    await page
      .locator(`${CANVAS_TILE}[data-terminal-id="${memberId(this)}"] ${LOCK}`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the second client should show the member terminal as driven by the Conductor",
  async function (this: KoluWorld) {
    await expectSecondDriver(this, "conductor");
  },
);

/** WITHOUT A RELOAD: the page is never navigated again after it opened, so
 *  the only way this attribute can move is the delta the server sent. */
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
  const banner = secondClient.page.locator(
    `${CANVAS_TILE}[data-terminal-id="${memberId(world)}"] ${LOCK}`,
  );
  await pollFor({
    observe: async () =>
      (await banner.first().getAttribute("data-driver")) ?? "absent",
    isDone: (seen) => seen === driver,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `the other browser still reads driver ${JSON.stringify(last)} rather than ${JSON.stringify(driver)} after ${ms}ms`,
      ),
  });
}

/** THE PHONE'S BAND sits directly above the key bar it gates — the control a
 *  blocked tap is pointed at is then a thumb's width from the key that was
 *  blocked, which is the whole reason it is drawn there rather than in a
 *  title bar the phone does not have. */
Then(
  "the lock should sit above the phone's key bar",
  async function (this: KoluWorld) {
    const lock = await this.page.locator(LOCK).first().boundingBox();
    const bar = await this.page
      .locator('[data-testid="mobile-key-bar"]')
      .boundingBox();
    assert.ok(lock && bar, "the phone shows no lock band above its key bar");
    assert.ok(
      lock.y + lock.height <= bar.y + 1,
      `the lock band (bottom ${lock.y + lock.height}) is not above the key bar (top ${bar.y})`,
    );
  },
);
