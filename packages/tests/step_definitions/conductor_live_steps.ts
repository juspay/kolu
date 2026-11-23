/** A PICKED WORK'S TERMINALS, LIVE — step definitions for the Terminals view
 *  of a picked work: a pane per terminal (`live-pane`, carrying the member's
 *  `data-role`), its head (`live-*`, the peek's head under another prefix)
 *  and its screen (`live-screen`).
 *
 *  Whether a key was heard is read off the terminal's own screen, as the
 *  peek's and the lock's steps read it: the implementor the Conductor starts
 *  runs the omp stand-in, which echoes every line it is given behind a
 *  marker it assembles at runtime (`support/agent-mock-omp.ts`). */

import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { OMP_HEARD_MARKER } from "../support/agent-mock-omp.ts";
import { readBufferText } from "../support/buffer.ts";
import {
  type ConductorScreen,
  expectLiveAtBottom,
  expectStaysScrolledBack,
  pressOn,
  wheelOver,
} from "../support/conductorScroll.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { showPickedView } from "./conductor_steps.ts";

const COLUMN = '[data-testid="work-column"]';
const PANE = `${COLUMN} [data-testid="live-pane"]`;

/** How long a BLOCKED key is watched for before the claim is made — the
 *  peek's and the lock's window. */
const BLOCKED_WINDOW_MS = 3_000;

const paneOf = (role: string): string => `${PANE}[data-role="${role}"]`;
const screenOf = (role: string): string =>
  `${paneOf(role)} [data-testid="live-screen"]`;

async function waitForCount(
  world: KoluWorld,
  selector: string,
  count: number,
): Promise<void> {
  await pollFor({
    observe: () => world.page.locator(selector).count(),
    isDone: (seen) => seen === count,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(`${selector} matched ${last} after ${ms}ms, expected ${count}`),
  });
}

async function waitForDriver(
  world: KoluWorld,
  role: string,
  driver: "conductor" | "you",
): Promise<void> {
  await pollFor({
    observe: () =>
      world.page
        .locator(`${paneOf(role)} [data-testid="live-lock"]`)
        .getAttribute("data-driver", { timeout: 500 })
        .catch(() => null),
    isDone: (seen) => seen === driver,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `the ${role}'s live terminal said ${JSON.stringify(last)} after ${ms}ms, expected ${JSON.stringify(driver)}`,
      ),
  });
}

/** CONNECTED PANES: the ones holding a read of their terminal's screen. */
Then(
  "the picked work should show {int} live terminal(s)",
  async function (this: KoluWorld, count: number) {
    await waitForCount(this, `${PANE}[data-connected]`, count);
  },
);

/** THE PANE'S SCREEN, by its own three numbers: does it pan? */
const scrollerOf = (role: string): string =>
  `${paneOf(role)} [data-testid="live-scroller"]`;

async function paneWidth(world: KoluWorld, role: string) {
  return await world.page.locator(scrollerOf(role)).evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
}

Then(
  "the {string} live pane should not pan",
  async function (this: KoluWorld, role: string) {
    await pollFor({
      observe: () => paneWidth(this, role),
      isDone: (box) => box.scroll <= box.client + 1,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (box, ms) =>
        new Error(
          `the ${role} pane pans after ${ms}ms: ${box.scroll}px of screen in ${box.client}px — Fit width did not fit it`,
        ),
    });
  },
);

Then(
  "the {string} live pane should pan",
  async function (this: KoluWorld, role: string) {
    await pollFor({
      observe: () => paneWidth(this, role),
      isDone: (box) => box.scroll > box.client + 1,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (box, ms) =>
        new Error(
          `the ${role} pane does not pan after ${ms}ms: ${box.scroll}px of screen in ${box.client}px`,
        ),
    });
  },
);

Then(
  "the {string} live pane's Fit width should be lit",
  async function (this: KoluWorld, role: string) {
    await pollFor({
      observe: () =>
        this.page
          .locator(`${paneOf(role)} [data-testid="live-fit"]`)
          .getAttribute("aria-pressed", { timeout: 500 })
          .catch(() => null),
      isDone: (pressed) => pressed === "true",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (pressed, ms) =>
        new Error(
          `the ${role} pane's Fit width read ${JSON.stringify(pressed)} after ${ms}ms, not "true"`,
        ),
    });
  },
);

When(
  "I press the {string} live pane's Fit width",
  async function (this: KoluWorld, role: string) {
    await this.page.locator(`${paneOf(role)} [data-testid="live-fit"]`).click();
  },
);

Then(
  "the {string} live pane should show no Fit width",
  async function (this: KoluWorld, role: string) {
    await waitForCount(this, `${paneOf(role)} [data-testid="live-fit"]`, 0);
  },
);

When("I show the work's details", async function (this: KoluWorld) {
  await showPickedView(this, "details");
});

When("I show the work's terminals", async function (this: KoluWorld) {
  await showPickedView(this, "terminals");
});

Then(
  "the picked work should offer {int} terminal tabs",
  async function (this: KoluWorld, count: number) {
    await waitForCount(this, `${COLUMN} [data-testid="live-tab"]`, count);
  },
);

Then(
  "the picked work should be showing its details",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () =>
        this.page
          .locator(`${COLUMN} [data-testid="work-card"][data-shape="picked"]`)
          .getAttribute("data-view", { timeout: 500 })
          .catch(() => null),
      isDone: (view) => view === "details",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the picked work showed ${JSON.stringify(last)} after ${ms}ms, not its details`,
        ),
    });
  },
);

/** TAKE OVER, from the pane's own head — done once the pane says the
 *  terminal is yours. */
When(
  "I take over the {string} in its live terminal",
  async function (this: KoluWorld, role: string) {
    await this.page
      .locator(`${paneOf(role)} [data-testid="live-take-over"]`)
      .click();
    await waitForDriver(this, role, "you");
  },
);

When(
  "I hand back the {string} in its live terminal",
  async function (this: KoluWorld, role: string) {
    await this.page
      .locator(`${paneOf(role)} [data-testid="live-hand-back"]`)
      .click();
  },
);

When(
  "I type {string} into the {string} live terminal",
  async function (this: KoluWorld, text: string, role: string) {
    await this.page.locator(`${screenOf(role)} .xterm-helper-textarea`).focus();
    await this.page.keyboard.type(text);
    await this.page.keyboard.press("Enter");
  },
);

Then(
  "the {string} live terminal should show the noted size after {string}",
  async function (this: KoluWorld, role: string, prefix: string) {
    assert.ok(this.peekNotedSize, "no terminal size was noted");
    const wanted = `${prefix}${this.peekNotedSize}`;
    await pollFor({
      observe: () => readBufferText(this.page, screenOf(role)),
      isDone: (seen) => seen.includes(wanted),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the ${role}'s live terminal never showed ${JSON.stringify(wanted)}; after ${ms}ms it reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

Then(
  "the {string} live terminal should say the Conductor is driving",
  async function (this: KoluWorld, role: string) {
    await waitForDriver(this, role, "conductor");
  },
);

Then(
  "the {string} live terminal should have heard {string}",
  async function (this: KoluWorld, role: string, text: string) {
    const wanted = `${OMP_HEARD_MARKER} ${text}`;
    await pollFor({
      observe: () => readBufferText(this.page, screenOf(role)),
      isDone: (seen) => seen.includes(wanted),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the ${role}'s live terminal never heard ${JSON.stringify(text)} after ${ms}ms; it reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

/** NOTHING THROUGH, for as long as a key that slipped past would take to
 *  show up on the screen. */
Then(
  "the {string} live terminal should not have heard {string}",
  async function (this: KoluWorld, role: string, text: string) {
    const deadline = Date.now() + BLOCKED_WINDOW_MS;
    for (;;) {
      const screen = await readBufferText(this.page, screenOf(role));
      if (screen.includes(text))
        throw new Error(
          `the lock let ${JSON.stringify(text)} through; the ${role}'s live terminal reads ${JSON.stringify(screen.trim().slice(-300))}`,
        );
      if (Date.now() >= deadline) return;
      await this.page.waitForTimeout(250);
    }
  },
);

Then(
  "the live terminal should have no key bar",
  async function (this: KoluWorld) {
    await waitForCount(this, `${PANE} [data-testid="mobile-key-bar"]`, 0);
  },
);

Then(
  "the live terminal should have a key bar",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${PANE} [data-testid="mobile-key-bar"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** A ROW IN THE PICKED WORK'S DETAILS, by its terminal's role. */
const rowOf = (role: string): string =>
  `${COLUMN} [data-testid="work-member"][data-role="${role}"]`;

/** INSPECT, from a live pane's head: the work's Details with that terminal's
 *  row unfolded. */
When(
  "I inspect the {string} in its live terminal",
  async function (this: KoluWorld, role: string) {
    await this.page
      .locator(`${paneOf(role)} [data-testid="live-inspect"]`)
      .click();
  },
);

/** UNFOLDED: the row's own toggle says so, and under it are the terminal's
 *  agent card and its Compose. */
Then(
  "the {string} row should be unfolded, with its agent card and Compose",
  async function (this: KoluWorld, role: string) {
    const row = this.page.locator(rowOf(role));
    await pollFor({
      observe: () =>
        row
          .locator('[data-testid="work-member-role"]')
          .getAttribute("aria-expanded", { timeout: 500 })
          .catch(() => null),
      isDone: (expanded) => expanded === "true",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the ${role}'s row said aria-expanded=${JSON.stringify(last)} after ${ms}ms`,
        ),
    });
    const inspector = row.locator('[data-testid="work-member-inspector"]');
    await inspector
      .locator('[data-testid="inspector-agent-card"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await inspector
      .locator('[data-testid="compose-input"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** SEND FROM THE ROW'S COMPOSE — the draft written into that terminal, on its
 *  own host, as the Right panel's Compose writes into the focused pane. */
When(
  "I send {string} from the {string} row's Compose",
  async function (this: KoluWorld, text: string, role: string) {
    const inspector = this.page.locator(
      `${rowOf(role)} [data-testid="work-member-inspector"]`,
    );
    await inspector.locator('[data-testid="compose-input"]').fill(text);
    await inspector.locator('[data-testid="compose-send"]').click();
  },
);

/** WHAT A LIVE PANE'S SCREEN SHOWS — any text on it, typed or printed. */
Then(
  "the {string} live terminal should show {string}",
  async function (this: KoluWorld, role: string, text: string) {
    await pollFor({
      observe: () => readBufferText(this.page, screenOf(role)),
      isDone: (seen) => seen.includes(text),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the ${role}'s live terminal never showed ${JSON.stringify(text)} after ${ms}ms; it reads ${JSON.stringify((last ?? "").trim().slice(-300))}`,
        ),
    });
  },
);

/** A LIVE PANE'S SCREEN AND ITS HEAD'S READOUT, for the scroll-back steps. */
const scrollingOf = (role: string): ConductorScreen => ({
  screen: screenOf(role),
  readout: `${paneOf(role)} [data-testid="live-live"]`,
  label: `the ${role}'s live terminal`,
});

When(
  "I wheel back over the {string} live terminal",
  async function (this: KoluWorld, role: string) {
    await wheelOver(this.page, scrollingOf(role), -500);
  },
);

When(
  "I wheel to the bottom of the {string} live terminal",
  async function (this: KoluWorld, role: string) {
    await wheelOver(this.page, scrollingOf(role), 20_000);
  },
);

/** SHIFT+PAGE UP, the keyboard's way back — pressed on the screen itself. A
 *  failure says whether the view left the bottom and was thrown back, or
 *  never scrolled. */
When(
  "I press Shift+PageUp in the {string} live terminal",
  async function (this: KoluWorld, role: string) {
    await pressOn(this.page, scrollingOf(role), "Shift+PageUp");
  },
);

Then(
  "the {string} live terminal should stay scrolled back",
  async function (this: KoluWorld, role: string) {
    await expectStaysScrolledBack(this.page, scrollingOf(role));
  },
);

Then(
  "the {string} live terminal should be live at the bottom",
  async function (this: KoluWorld, role: string) {
    await expectLiveAtBottom(this.page, scrollingOf(role));
  },
);
