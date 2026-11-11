/** The Orchestrator — step definitions.
 *
 *  Every step drives the real chain: the browser writes through
 *  `orchestrator.prompt`, kolu-server forwards it to padi, padi's harness
 *  writes a `session/prompt` down a pipe to the scripted adapter
 *  (`support/acp-fixture-agent.ts`), and the frames come back the same way.
 *  Nothing here stubs a store, so a step that passes is evidence about the
 *  wire and not about a value somebody put in a signal.
 */

import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const PANE = '[data-testid="orchestrator-pane"]';
const SEGMENT = '[data-testid="mode-orchestrator"]';
const BADGE = '[data-testid="orchestrator-badge"]';
const CHIP = '[data-testid="orchestrator-phase"]';
const TRANSCRIPT = '[data-testid="orchestrator-transcript"]';
const ROW = '[data-testid="orchestrator-row"]';
const TOOL_CARD = '[data-testid="orchestrator-tool-card"]';
const INPUT = '[data-testid="orchestrator-input"]';
const SEND = '[data-testid="orchestrator-send"]';
const FLEET_ROW = '[data-testid="orchestrator-fleet-row"]';
const ASK = '[data-testid="orchestrator-ask"]';
const PEEK = '[data-testid="orchestrator-peek"]';
const DOCK = '[data-testid="dock"]';
const USER_MARK = '[data-testid="orchestrator-user-mark"]';

/** The mode's own chord, as `input/actions.ts` spells it: `modifier: "app"`,
 *  which is Meta on every platform — `cmdOrCtrl` would resolve to
 *  `Ctrl+Shift+O`, a chord `prohibitedKeybinds.ts` reserves for the agent
 *  running inside a PTY. Typing the reserved form here would pass against a
 *  build that had made exactly that mistake. */
const ORCHESTRATOR_CHORD = "Meta+Shift+O";

/** One waiting shape for every assertion in this file, so a failure says what
 *  was expected, what was actually there, and how long it waited — rather than
 *  Playwright's bare "locator not found". */
async function waitForValue(
  what: string,
  observe: () => Promise<string>,
  want: string,
): Promise<void> {
  await pollFor({
    observe,
    isDone: (seen) => seen === want,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what}: expected ${JSON.stringify(want)}, last saw ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
}

async function waitForCount(
  world: KoluWorld,
  selector: string,
  want: number,
): Promise<void> {
  await waitForValue(
    `${selector} count`,
    async () => String(await world.page.locator(selector).count()),
    String(want),
  );
}

async function enterOrchestrator(world: KoluWorld): Promise<void> {
  await world.page.locator(SEGMENT).click();
  await world.page
    .locator(PANE)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

async function sendPrompt(world: KoluWorld, text: string): Promise<void> {
  const input = world.page.locator(INPUT);
  await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await input.click();
  await input.fill(text);
  await world.page.locator(SEND).click();
}

When("I press the orchestrator shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(ORCHESTRATOR_CHORD);
});

When("I enter orchestrator mode", async function (this: KoluWorld) {
  await enterOrchestrator(this);
});

When(
  "I send the orchestrator the prompt {string}",
  async function (this: KoluWorld, text: string) {
    await sendPrompt(this, text);
  },
);

When(
  "I ask the orchestrator to adopt the terminal",
  async function (this: KoluWorld) {
    // The fixture answers its `lifecycle_create` with the id it was given, so
    // the fleet row and the peek pane are about a terminal that really exists
    // in padi's registry — a made-up id would render a row with nothing behind
    // it and prove nothing about the join.
    const ids = await this.terminalIds();
    assert.ok(
      ids[0],
      "a terminal must exist before the orchestrator can adopt one",
    );
    await sendPrompt(this, `adopt ${ids[0]}`);
  },
);

When(
  "I click the first orchestrator fleet row",
  async function (this: KoluWorld) {
    await this.page.locator(FLEET_ROW).first().click();
  },
);

When(
  "I answer the orchestrator's question with {string}",
  async function (this: KoluWorld, value: string) {
    const ask = this.page.locator(ASK).last();
    await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ask
      .locator(`[data-testid="orchestrator-ask-option"][data-value="${value}"]`)
      .click();
    await ask.locator('[data-testid="orchestrator-ask-submit"]').click();
  },
);

Then(
  "the orchestrator pane should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANE)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the orchestrator pane should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANE)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then("the dock should be a sidebar", async function (this: KoluWorld) {
  // The same single mounted Dock the maximized posture uses, wearing the
  // sidebar's own attribute — asserting the attribute rather than a class is
  // what keeps this green through a restyle.
  await waitForValue(
    "dock sidebar attribute",
    async () =>
      (await this.page.locator(DOCK).getAttribute("data-maximized")) ??
      "absent",
    "",
  );
});

Then(
  "the orchestrator mode segment should be active",
  async function (this: KoluWorld) {
    await waitForValue(
      "orchestrator segment active attribute",
      async () =>
        (await this.page.locator(SEGMENT).getAttribute("data-active")) ??
        "absent",
      "",
    );
  },
);

Then(
  "the orchestrator mode segment should show a badge of {int}",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "orchestrator badge",
      async () => (await this.page.locator(BADGE).textContent()) ?? "absent",
      String(count),
    );
  },
);

Then(
  "the orchestrator mode segment should show no badge",
  async function (this: KoluWorld) {
    // ABSENT, not "0": a badge element that renders an empty count cannot be
    // told from one that renders the wrong one.
    await waitForCount(this, BADGE, 0);
  },
);

Then(
  "the orchestrator transcript should show a {string} row saying {string}",
  async function (this: KoluWorld, kind: string, text: string) {
    await waitForCount(
      this,
      `${TRANSCRIPT} ${ROW}[data-row-kind="${kind}"]:has-text(${JSON.stringify(text)})`,
      1,
    );
  },
);

Then(
  "the orchestrator transcript should show a {string} tool card",
  async function (this: KoluWorld, toolKind: string) {
    await waitForCount(this, `${TOOL_CARD}[data-tool-kind="${toolKind}"]`, 1);
  },
);

Then(
  "that tool card should name the terminal {string}",
  async function (this: KoluWorld, name: string) {
    await waitForCount(
      this,
      `${TOOL_CARD}:has-text(${JSON.stringify(name)})`,
      1,
    );
  },
);

Then(
  "that tool card should offer to open its tile",
  async function (this: KoluWorld) {
    await waitForCount(
      this,
      `${TOOL_CARD} [data-testid="orchestrator-tool-open-tile"]`,
      1,
    );
  },
);

Then(
  "the orchestrator state chip should read {string}",
  async function (this: KoluWorld, phase: string) {
    await waitForValue(
      "orchestrator state chip",
      async () => (await this.page.locator(CHIP).textContent())?.trim() ?? "",
      phase,
    );
  },
);

Then("the orchestrator should be asking", async function (this: KoluWorld) {
  await waitForValue(
    "orchestrator phase",
    async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    "asking",
  );
});

Then("the orchestrator should not be asking", async function (this: KoluWorld) {
  await pollFor({
    observe: async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    isDone: (phase) => phase !== "asking",
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `orchestrator phase stayed ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
});

Then(
  "the orchestrator fleet should list {int} terminal",
  async function (this: KoluWorld, count: number) {
    await waitForCount(this, FLEET_ROW, count);
  },
);

Then(
  "the peek pane should show that terminal",
  async function (this: KoluWorld) {
    const id = await this.page
      .locator(FLEET_ROW)
      .first()
      .getAttribute("data-terminal-id");
    assert.ok(id, "a fleet row must name its terminal");
    await waitForValue(
      "peek pane terminal",
      async () =>
        (await this.page.locator(PEEK).getAttribute("data-terminal-id")) ??
        "absent",
      id,
    );
  },
);

Then(
  "the orchestrator transcript should mark a user row {string}",
  async function (this: KoluWorld, mark: string) {
    await pollFor({
      observe: () =>
        this.page.locator(`${USER_MARK}[data-mark="${mark}"]`).count(),
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `no user row was marked ${JSON.stringify(mark)} after ${elapsedMs}ms`,
        ),
    });
  },
);

Then(
  "the orchestrator transcript should mark no user row {string}",
  async function (this: KoluWorld, mark: string) {
    await waitForCount(this, `${USER_MARK}[data-mark="${mark}"]`, 0);
  },
);
