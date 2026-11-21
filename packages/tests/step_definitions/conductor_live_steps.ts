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
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

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
