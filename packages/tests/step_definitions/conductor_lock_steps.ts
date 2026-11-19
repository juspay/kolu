/** THE LOCK — step definitions for a terminal the Conductor drives.
 *
 *  A member of a waterfall is READ-ONLY to the person until they take it
 *  over, and these steps say that where it can be seen from outside: the
 *  frame around the terminal's body, the card typing raises over it, the
 *  pill that says the terminal is theirs — and the PTY itself.
 *
 *  NOTHING IS IN THE TILE'S HEADER any more, so nothing here reads it. The
 *  lock's whole resting state is a border on the body (`work-lock`, which
 *  carries the driver), and the control appears only when a person types
 *  (`work-lock-card`). Each of them names the terminal it is about in
 *  `data-lock-terminal` — a fleet ref, so the match is on its `/<id>` tail,
 *  the same way the work column's member rows are found.
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

/** One of the lock's three pieces, for THIS member terminal and no other:
 *  the frame, the card or the pill. The ref's tail is what identifies it —
 *  the host half is the browser's business, not a test's. */
function lockPart(world: KoluWorld, testid: string, page?: Page): Locator {
  return (page ?? world.page).locator(
    `${testid}[data-lock-terminal$="/${memberId(world)}"]`,
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
      `[data-testid="work-column"] [data-testid="work-member"][data-ref$="/${id}"] [data-testid="work-member-name"]`,
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

/** WHO DRIVES IT, read off the frame around the terminal's body — the one
 *  resting-state mark there is, and the same fact the keystroke gate reads.
 *  It is what a person sees without typing a thing. */
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

/** THE PILL, in a corner of the body — the only thing drawn while a person
 *  has the terminal, and the way they give it back. */
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

/** THE CARD typing raises: the sentence, and the control it is there for. */
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

/** CENTRED OVER THE TERMINAL — over the body the keystroke went to, not in a
 *  header, not in a band of its own. Containment is the claim a phone and a
 *  tiled desktop can both make. */
Then(
  "the lock card should sit over the member terminal",
  async function (this: KoluWorld) {
    const card = await lockPart(this, CARD).first().boundingBox();
    // The INNER container (the one with the font size) is the terminal's
    // body — a bare `[data-terminal-id]` also names its dock row, which is a
    // different box on the other side of the window.
    const body = await this.page
      .locator(memberTerminal(this))
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

/** The card is a BRIEF thing — it goes by itself, which is also what lets a
 *  later blocked input raise one that means something. */
When("the lock card goes by itself", async function (this: KoluWorld) {
  await pollFor({
    observe: () => lockPart(this, CARD).count(),
    isDone: (count) => count === 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (_last, ms) =>
      new Error(`the card never went by itself; still up ${ms}ms later`),
  });
});

/** Esc puts the card away — `I press Escape` is the shared step, pressed at
 *  the terminal where the card is. The key never reaches the PTY either way
 *  (a driven terminal takes no keys), so dismissal is all it says. */

/** TAKE OVER IS ON THE CARD, so the card is what this presses — raising it
 *  first, by typing, when a step has not already. The key that raises it is
 *  swallowed by the very lock being taken over, which is why it can be any
 *  key at all. */
When("I take over the member terminal", async function (this: KoluWorld) {
  const card = lockPart(this, CARD);
  if ((await card.count()) === 0) {
    await this.focusForTyping(`[data-terminal-id="${memberId(this)}"]`);
    await this.page.keyboard.type("k");
    await card.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  }
  await card.first().locator('[data-testid="work-take-over"]').click();
});

/** HAND BACK IS ON THE PILL, the one thing drawn while the terminal is the
 *  person's. */
When("I hand the member terminal back", async function (this: KoluWorld) {
  await lockPart(this, PILL).first().click();
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
    await this.focusForTyping(`[data-terminal-id="${memberId(this)}"]`);
    await this.page.keyboard.press(`${MOD_KEY}+KeyV`);
  },
);

/** THE STAND-IN IS UP, said where the scenario needs it to be: the marker is
 *  the last thing its boot prints before the read loop, and only the
 *  stand-in's own print can put it on the screen. Waiting for it says the
 *  tile is on screen AND the output it missed while nobody watched it has been
 *  replayed, which is what the screen comparisons below rest on. */
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
          `the lock let ${JSON.stringify(text)} through; the member terminal's screen tail reads ${JSON.stringify(screen.trim().slice(-300))}`,
        );
      }
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  },
);

/** READING IS UNTOUCHED. A drag across the terminal selects, exactly as it
 *  does on any other terminal — the lock is about input alone, and a tile a
 *  person cannot even copy out of would be a different (and worse) product.
 *  The card is up while this runs, so this is also the claim that a card
 *  centred over the terminal is not in the way of reading it.
 *
 *  THE ROW IS FOUND, NEVER GUESSED: a drag along a blank row selects nothing
 *  on any terminal, locked or not, and would fail here as if the lock had
 *  reached reading. So the first row with text on it is read off the buffer
 *  and the pointer is put on THAT row — a real drag, over something there is
 *  to select. */
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
    }, memberTerminal(this));
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
  // A SCREEN STILL FILLING IS NOT A BASELINE, and AN EMPTY ONE IS NOT A
  // SCREEN. The terminal this claim is about was started moments ago by the
  // conversation and was never on anybody's canvas until the step before
  // this one — a tile nobody has seen takes no output, so the browser holds
  // NOTHING for it until it is shown and the server replays what it missed.
  // Two empty readings agree with each other, so quiet alone would note a
  // blank screen and then read that replay as the keystroke the lock was
  // supposed to swallow. Wait for output to be there AND to have stopped
  // moving, and note THAT.
  let last = await memberScreen(this);
  const deadline = Date.now() + POLL_TIMEOUT;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    const now = await memberScreen(this);
    if (now === last && now.trim() !== "") {
      notedScreen = now;
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(
        now.trim() === ""
          ? `the member terminal's screen is still empty after ${POLL_TIMEOUT}ms, so there is nothing to compare against`
          : `the member terminal never stopped printing, so nothing here is a baseline; its screen tail reads ${JSON.stringify(now.trim().slice(-300))}`,
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

function dockRow(world: KoluWorld): string {
  return `[data-testid="dock-row"][data-terminal-id="${memberId(world)}"]`;
}

/** THE MARK OUTSIDE THE PANE carries the driver too — the dock is where a
 *  person looks to see what is happening across the fleet, and a terminal
 *  they took over has to read as theirs there. */
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

/** THE NAME IS STILL THE ROW'S FIRST LINE. The mark sits BESIDE it, and the
 *  two have separate boxes that do not meet — the mark drawn over the name
 *  is the bug this is here for (#2376 review). */
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

/** NOTHING DRIVES IT. Said about a terminal whose mark is already on screen
 *  (the step above), so this cannot pass by looking at a terminal that is
 *  not there. */
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
