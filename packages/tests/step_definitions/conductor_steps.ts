/** The Conductor — step definitions.
 *
 *  Every step drives the real chain: the browser writes through
 *  `conductor.prompt` on the KOLU surface, kolu-server's one conversation
 *  writes a `session/prompt` down a pipe to the scripted adapter
 *  (`support/acp-fixture-agent.ts`), and the frames come back the same way.
 *  Nothing here stubs a store, so a step that passes is evidence about the
 *  wire and not about a value somebody put in a signal.
 *
 *  The conversation is reached from its own tab — the `◆ Conductor` tab, first
 *  in the chrome bar's tab row — never from the view-mode control, which
 *  carries `▦ canvas · ▢ maximized` for host tabs and nothing else.
 */

import assert from "node:assert";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Given, Then, When } from "@cucumber/cucumber";
import {
  ompMockPayload,
  ompTranscriptPath,
  stageOmpPrompt,
  updateOmpFixture,
} from "../support/agent-mock-omp.ts";
import { type PrFixture, statePullRequest } from "../support/fake-gh.ts";
import { restartKoluServer } from "../support/hooks.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";

/** How long a scenario leaves a landed wake alone before claiming it rang ONCE.
 *  Wider than the server's own re-report cadence, so a second ring has time to
 *  arrive and be counted rather than merely not having happened yet. */
const REPEAT_WAKE_WINDOW_MS = 4_000;

/** The scratch dir behind an agent the CONDUCTOR started (`I ask the conductor
 *  to run an agent in a new terminal`) — the session bytes it stages for its
 *  first prompt live inside it. The terminal itself is padi's to reap; this is
 *  the fixture's own leavings. */
let conductorAgentCwd: string | null = null;

After(() => {
  if (conductorAgentCwd && fs.existsSync(conductorAgentCwd)) {
    fs.rmSync(conductorAgentCwd, { recursive: true, force: true });
  }
  conductorAgentCwd = null;
});

const PANE = '[data-testid="conductor-pane"]';
/** The conversation's OWN tab, first in the tab row — not a host tab, and not
 *  a segment of the mode control (which no longer has one). */
const TAB = '[data-testid="conductor-tab"]';
/** The phone's pull handle — the way into its chrome sheet, the phone's tab
 *  row. */
const MOBILE_HANDLE = '[data-testid="mobile-pull-handle"]';
const MOBILE_SHEET = '[data-testid="mobile-chrome-sheet"]';
const BADGE = `${TAB} [data-testid="conductor-badge"]`;
/** The phase word on the status line above the composer. */
const PHASE = '[data-testid="conductor-phase"]';
const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const ROW = '[data-testid="conductor-row"]';
const TOOL_CARD = '[data-testid="conductor-tool-card"]';
const INPUT = '[data-testid="conductor-input"]';
const SEND = '[data-testid="conductor-send"]';
const ASK = '[data-testid="conductor-ask"]';
/** The `⋯` menu button, its portalled panel, and the two-press `New session`
 *  inside it: the button ARMS and the confirm commits. The old one-press
 *  `conductor-new-session` is gone — a wipe is not something a stray click
 *  should be able to do. */
const MENU = '[data-testid="conductor-menu"]';
const MENU_PANEL = '[data-testid="conductor-menu-panel"]';
const MENU_NEW_SESSION = '[data-testid="conductor-menu-new-session"]';
const MENU_NEW_SESSION_CONFIRM =
  '[data-testid="conductor-menu-new-session-confirm"]';
const USER_MARK = '[data-testid="conductor-user-mark"]';
const CHIP_ATTACHMENT = '[data-testid="conductor-attachment-chip"]';
const ROW_ATTACHMENT = '[data-testid="conductor-row-attachment"]';
const CHROME_BAR = '[data-testid="chrome-bar"]';
/** The REAL host tabs. `host-chip` also matches the hidden measuring twin the
 *  strip keeps for its overflow computation, so every count of "the hosts"
 *  scopes under the visible row. */
const HOST_TAB = '[data-testid="host-chip-row"] [data-testid="host-chip"]';
const CANVAS_TILE = '[data-testid="canvas-tile"]';

/** The mode's own chord, as `input/actions.ts` spells it: `modifier: "app"`,
 *  which is Meta on every platform — `cmdOrCtrl` would resolve to
 *  `Ctrl+Shift+O`, a chord `prohibitedKeybinds.ts` reserves for the agent
 *  running inside a PTY. Typing the reserved form here would pass against a
 *  build that had made exactly that mistake. */
const CONDUCTOR_CHORD = "Meta+Shift+O";

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

async function waitForAtLeastOne(
  world: KoluWorld,
  selector: string,
): Promise<void> {
  await pollFor({
    observe: () => world.page.locator(selector).count(),
    isDone: (seen) => seen > 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (_last, elapsedMs) =>
      new Error(`nothing matched ${selector} after ${elapsedMs}ms`),
  });
}

/** IDEMPOTENT, because the selected tab is persisted per device: a reload comes
 *  back in the conversation, and a step that pressed the entry unconditionally
 *  would LEAVE it exactly in the scenario that reloads.
 *
 *  On a PHONE the tab lives in the pull-down chrome sheet, so the handle is
 *  pulled first — the same two taps a person makes. */
async function enterConductor(world: KoluWorld): Promise<void> {
  const pane = world.page.locator(PANE);
  if (await pane.isVisible()) return;
  const handle = world.page.locator(MOBILE_HANDLE);
  if (await handle.isVisible()) await handle.click();
  const tab = world.page.locator(TAB);
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  if ((await tab.getAttribute("data-active")) === null) await tab.click();
  await pane.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

async function sendPrompt(world: KoluWorld, text: string): Promise<void> {
  const input = world.page.locator(INPUT);
  await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await input.click();
  await input.fill(text);
  await world.page.locator(SEND).click();
}

/** WHAT THE TRANSCRIPT ACTUALLY HOLDS, for a failure message. Row kind, the
 *  mark if it wears one, and how many attachments it carries — the three facts
 *  that tell "no row was minted at all" apart from "a row is there and it
 *  carries nothing". */
async function transcriptInventory(world: KoluWorld): Promise<string> {
  const rows = await world.page.locator(ROW).evaluateAll((all) =>
    all.map((row) => {
      const kind = row.getAttribute("data-row-kind");
      const mark = row.querySelector('[data-testid="conductor-user-mark"]');
      const files = row.querySelectorAll(
        '[data-testid="conductor-row-attachment"]',
      );
      const text = (row.textContent ?? "").replace(/\s+/g, " ").trim();
      return `${kind}${mark === null ? "" : `(${mark.getAttribute("data-mark")})`}[${files.length} attached] ${JSON.stringify(text.slice(0, 60))}`;
    }),
  );
  return rows.length === 0 ? "(no rows)" : rows.join(" | ");
}

/** Every toast on screen. A prompt refused BEFORE a row exists — an attachment
 *  this agent was never told it could take, a message over the cap — has no row
 *  to land on, and the toast is its only face. So a missing user row is only
 *  half an observation without this. */
async function toastInventory(world: KoluWorld): Promise<string[]> {
  return world.page
    .locator("[data-sonner-toaster] li")
    .evaluateAll((all) =>
      all.map((toast) => (toast.textContent ?? "").replace(/\s+/g, " ").trim()),
    );
}

When("I press the conductor shortcut", async function (this: KoluWorld) {
  await this.page.keyboard.press(CONDUCTOR_CHORD);
});

When("I enter conductor mode", async function (this: KoluWorld) {
  await enterConductor(this);
});

/** THE GESTURE, as the product spells it: the `⋯` menu, `New session`, and a
 *  second press to confirm — a wipe is not something a stray click may do. It
 *  wipes the CONVERSATION and nothing else, which is what the work-record
 *  scenario below is about, so the arrangement and the act are one function. */
async function pressNewSession(world: KoluWorld): Promise<void> {
  await enterConductor(world);
  await world.page.locator(MENU).click();
  // The panel is PORTALLED, so it is waited for rather than assumed: a click
  // on an arming row that has not mounted yet is a click on nothing, and the
  // confirm below would then time out three lines away from the cause.
  await waitForAtLeastOne(world, MENU_PANEL);
  await world.page.locator(MENU_NEW_SESSION).click();
  await world.page.locator(MENU_NEW_SESSION_CONFIRM).click();
}

/** How long one wipe is given to land before it is made again. */
const WIPE_SETTLE_MS = 5_000;

async function newConductorSession(world: KoluWorld): Promise<void> {
  // TWICE, IF THE FIRST ONE IS LANDED ON. A wipe ends the turn that was in
  // flight, and an agent whose call was cancelled says so — a row that
  // arrives AFTER the transcript was emptied, which is the conversation
  // behaving correctly and an arrangement that is no longer fresh. The second
  // gesture clears what the first one's ending wrote; a scenario that still
  // cannot get an empty transcript fails on the full wait below, saying what
  // the transcript holds.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await pressNewSession(world);
    const empty = await pollFor({
      observe: () => world.page.locator(`${TRANSCRIPT} ${ROW}`).count(),
      isDone: (rows) => rows === 0,
      timeoutMs: WIPE_SETTLE_MS,
      onTimeout: (rows) =>
        new Error(`the transcript still holds ${rows ?? "?"} rows`),
    }).catch(() => -1);
    if (empty === 0) break;
  }
  await waitForCount(world, `${TRANSCRIPT} ${ROW}`, 0);
  await waitForValue(
    "conductor phase after a new session",
    async () =>
      (await world.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    "idle",
  );
}

Given(
  "the conductor is on a fresh conversation",
  async function (this: KoluWorld) {
    await newConductorSession(this);
  },
);

When("I start a new conductor session", async function (this: KoluWorld) {
  await newConductorSession(this);
});

Then(
  "the conductor transcript should be empty",
  async function (this: KoluWorld) {
    await waitForCount(this, `${TRANSCRIPT} ${ROW}`, 0);
  },
);

When(
  "I send the conductor the prompt {string}",
  async function (this: KoluWorld, text: string) {
    await sendPrompt(this, text);
  },
);

When(
  "I ask the conductor to adopt the terminal",
  async function (this: KoluWorld) {
    // The fixture answers its `lifecycle_create` with the id it was given —
    // qualified by the host, as the fleet grammar requires — so the card names
    // a terminal that really exists in padi's registry and "open tile" lands on
    // a tile that is really there. A made-up id would prove nothing about the
    // join.
    const ids = await this.terminalIds();
    assert.ok(
      ids[0],
      "a terminal must exist before the conductor can adopt one",
    );
    this.adoptedTerminalId = ids[0];
    await sendPrompt(this, `adopt ${ids[0]}`);
  },
);

When(
  "I ask the conductor to adopt the terminal I am in",
  async function (this: KoluWorld) {
    // THE FOCUSED tile, read before the conversation covers the canvas — not
    // the first id in the DOM, which is whichever terminal happens to be drawn
    // first. A Look at the wrong terminal shows a real screen that is simply
    // not the one the scenario typed into.
    const id = await this.page
      .locator(`${CANVAS_TILE}[data-active]`)
      .getAttribute("data-terminal-id", { timeout: POLL_TIMEOUT });
    assert.ok(id, "no tile is focused, so there is nothing to adopt");
    this.adoptedTerminalId = id;
    await enterConductor(this);
    await sendPrompt(this, `adopt ${id}`);
  },
);

When(
  "I answer the conductor's question with {string}",
  async function (this: KoluWorld, value: string) {
    const ask = this.page.locator(ASK).last();
    await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ask
      .locator(`[data-testid="conductor-ask-option"][data-value="${value}"]`)
      .click();
    await ask.locator('[data-testid="conductor-ask-submit"]').click();
  },
);

Then(
  "the answered question should read {string}",
  async function (this: KoluWorld, line: string) {
    // THE RECORD, read off the settled card: the question and the answer, on
    // one line. The form is gone by now, so this is the only place either of
    // them can still be read — a card that collapsed to `answered` fails here.
    const ask = this.page.locator(ASK).last();
    await pollFor({
      observe: async () =>
        (
          await ask
            .locator('[data-testid="conductor-ask-answer"]')
            .allTextContents()
        ).map((one) => one.replace(/\s+/g, " ").trim()),
      isDone: (read) => read.includes(line),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (read, elapsedMs) =>
        new Error(
          `after ${elapsedMs}ms the settled question reads ${JSON.stringify(read)}, not ${JSON.stringify(line)}`,
        ),
    });
  },
);

Then("the conductor pane should be visible", async function (this: KoluWorld) {
  await this.page
    .locator(PANE)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the conductor pane should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PANE)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the conductor pane should fill the workspace",
  async function (this: KoluWorld) {
    // CHAT ONLY, measured rather than asserted by the absence of a testid: the
    // pane spans the full width and runs from the chrome bar to the bottom of
    // the window. A dock column, a fleet list or a peek pane beside it would
    // take width from this box, and this step would say by how much.
    const pane = await this.page.locator(PANE).boundingBox();
    const bar = await this.page.locator(CHROME_BAR).boundingBox();
    const viewport = this.page.viewportSize();
    assert.ok(pane, "the conductor pane has no box");
    assert.ok(bar, "the chrome bar has no box");
    assert.ok(viewport, "the page has no viewport size");
    // HOW it is laid out, not only how big it came out: a pane that covers the
    // workspace does it by being taken out of the flow, so a box that came up
    // short says whether it is an overlay that was squeezed or an element that
    // is in the flow beside the canvas — two different bugs with one symptom.
    const laidOut = await this.page.locator(PANE).evaluate((el) => {
      const style = getComputedStyle(el);
      const parent = el.parentElement;
      return `position: ${style.position}, parent ${parent?.className ?? "(none)"} is ${parent === null ? "?" : Math.round(parent.getBoundingClientRect().width)}px wide`;
    });
    // A pixel of slack, because a fractional device-pixel ratio can land a
    // full-bleed box a hair off an integer viewport.
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
    assert.ok(
      near(pane.width, viewport.width),
      `the conductor pane is ${pane.width}px wide in a ${viewport.width}px window — something is beside it (${laidOut})`,
    );
    assert.ok(
      near(pane.y, bar.y + bar.height),
      `the conductor pane starts at y=${pane.y}, the chrome bar ends at y=${bar.y + bar.height} (${laidOut})`,
    );
    assert.ok(
      near(pane.y + pane.height, viewport.height),
      `the conductor pane ends at y=${pane.y + pane.height} in a ${viewport.height}px window (${laidOut})`,
    );
  },
);

Then("the conductor tab should be active", async function (this: KoluWorld) {
  await waitForValue(
    "conductor tab active attribute",
    async () =>
      (await this.page.locator(TAB).getAttribute("data-active")) ?? "absent",
    "",
  );
});

When("I note the active host tab", async function (this: KoluWorld) {
  const key = await this.page
    .locator(`${HOST_TAB}[data-active]`)
    .getAttribute("data-host");
  assert.ok(key, "no host tab is active");
  this.notedHostKey = key;
});

Then(
  "the active host tab should be the one I noted",
  async function (this: KoluWorld) {
    const noted = this.notedHostKey;
    assert.ok(noted, "no host tab was noted");
    await waitForValue(
      "active host tab after the round trip",
      async () =>
        (await this.page
          .locator(`${HOST_TAB}[data-active]`)
          .getAttribute("data-host")) ?? "absent",
      noted,
    );
  },
);

Then("no host tab should be the conductor", async function (this: KoluWorld) {
  // The conversation is NOT a host: it has no host key and no entry in the
  // host map, so it must appear nowhere the UI enumerates hosts — not as a
  // chip in the tab row, not as a row in the switcher the narrow layout
  // mounts, not inside the host strip at all.
  const hosts = await this.page
    .locator(HOST_TAB)
    .evaluateAll((all) =>
      all.map(
        (chip) =>
          `${chip.getAttribute("data-host")}=${(chip.textContent ?? "").replace(/\s+/g, " ").trim()}`,
      ),
    );
  assert.ok(hosts.length > 0, "the host tab row is empty");
  for (const host of hosts) {
    assert.ok(!/conductor/i.test(host), `a host tab is the conductor: ${host}`);
  }
  // The entry lives BESIDE the strip, never inside it — the one structural
  // fact a hue or a label change cannot quietly undo.
  assert.equal(
    await this.page
      .locator(`[data-testid="host-selector-strip"] ${TAB}`)
      .count(),
    0,
    "the conductor entry is mounted inside the host selector strip",
  );
  for (const prefix of ["host-select", "host-dropdown-switcher"]) {
    const options = await this.page
      .locator(`[data-testid="${prefix}"]`)
      .evaluateAll((all) =>
        all.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim()),
      );
    for (const option of options) {
      assert.ok(
        !/conductor/i.test(option),
        `${prefix} offers the conductor as a host: ${option}`,
      );
    }
  }
});

/** How many host tabs are drawn as the CURRENT one — the lit class and the
 *  `aria-selected` a tab list reads out — across both layouts the strip can
 *  mount (the chip row, and the narrow range's one-tab switcher). The two must
 *  agree, so both are counted and the step fails if they do not. The strip's
 *  hidden measuring twins are `visibility: hidden`, which the visibility check
 *  is told to honour. */
async function currentHostTabs(world: KoluWorld): Promise<number> {
  // One query per fact, each its own browser-side evaluation: a NAMED helper
  // inside the callback is rewritten by the step loader into a `__name` call
  // the page has never heard of.
  const shown = (selector: string) =>
    world.page
      .locator(`[data-testid="host-selector-strip"] ${selector}`)
      .evaluateAll(
        (all) =>
          all.filter((el) => el.checkVisibility({ visibilityProperty: true }))
            .length,
      );
  const counts = {
    lit: await shown(".host-tab-active"),
    selected: await shown('[role="tab"][aria-selected="true"]'),
  };
  assert.ok(
    counts.lit === counts.selected,
    `host tabs disagree about which is current: ${JSON.stringify(counts)}`,
  );
  return counts.lit;
}

Then("no host tab should look current", async function (this: KoluWorld) {
  await waitForValue(
    "host tabs drawn as current",
    async () => String(await currentHostTabs(this)),
    "0",
  );
});

Then(
  "exactly one host tab should look current",
  async function (this: KoluWorld) {
    await waitForValue(
      "host tabs drawn as current",
      async () => String(await currentHostTabs(this)),
      "1",
    );
  },
);

Then(
  "the conductor tab should come first in the tab row",
  async function (this: KoluWorld) {
    // By where it is DRAWN, not by markup order: the claim a person checks is
    // that the tab sits before the hosts, on the same floor as them.
    const tab = await this.page.locator(TAB).boundingBox();
    const first = await this.page.locator(HOST_TAB).first().boundingBox();
    assert.ok(tab !== null && first !== null, "a tab is not on screen");
    assert.ok(
      tab.x + tab.width <= first.x,
      `the conductor tab ends at x=${tab.x + tab.width}, after the first host tab starts at x=${first.x}`,
    );
    assert.ok(
      Math.abs(tab.y + tab.height - (first.y + first.height)) <= 1,
      `the conductor tab's floor (y=${tab.y + tab.height}) is not the host tabs' (y=${first.y + first.height})`,
    );
  },
);

/** The chrome-bar controls that describe a HOST's canvas. */
const HOST_VIEW_CONTROLS = ["mode-control", "dock-toggle", "inspector-toggle"];

async function shownHostViewControls(world: KoluWorld): Promise<string[]> {
  const shown: string[] = [];
  for (const id of HOST_VIEW_CONTROLS) {
    if (
      await world.page
        .locator(`${CHROME_BAR} [data-testid="${id}"]`)
        .isVisible()
    )
      shown.push(id);
  }
  return shown;
}

Then(
  "the host view controls should be shown",
  async function (this: KoluWorld) {
    await waitForValue(
      "host view controls shown",
      async () => (await shownHostViewControls(this)).join(","),
      HOST_VIEW_CONTROLS.join(","),
    );
  },
);

Then(
  "the host view controls should not be shown",
  async function (this: KoluWorld) {
    await waitForValue(
      "host view controls shown",
      async () => (await shownHostViewControls(this)).join(","),
      "",
    );
  },
);

Then(
  "the conductor tab should show a badge of {int}",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "conductor badge",
      async () => (await this.page.locator(BADGE).textContent()) ?? "absent",
      String(count),
    );
  },
);

Then(
  "the conductor tab should show no badge",
  async function (this: KoluWorld) {
    // ABSENT, not "0": a badge element that renders an empty count cannot be
    // told from one that renders the wrong one.
    await waitForCount(this, BADGE, 0);
  },
);

/** The badge's COLOUR, read as the fact that drives it (`data-asking`) and
 *  never as a class name: what the tab promises is "this is the needs-you
 *  badge", and pinning a utility class would pin the paint instead — a
 *  rename of the token would fail here while the product was fine, and a
 *  badge that stopped turning violet would pass. */
Then(
  "the conductor tab badge should be the needs-you one",
  async function (this: KoluWorld) {
    await waitForValue(
      "conductor badge data-asking",
      async () =>
        (await this.page.locator(BADGE).getAttribute("data-asking")) ??
        "absent",
      "",
    );
  },
);

Then(
  "the conductor tab badge should not be the needs-you one",
  async function (this: KoluWorld) {
    await waitForValue(
      "conductor badge data-asking",
      async () =>
        (await this.page.locator(BADGE).getAttribute("data-asking")) ??
        "absent",
      "absent",
    );
  },
);

Then(
  "the conductor transcript should show a row of kind {string} saying {string}",
  async function (this: KoluWorld, kind: string, text: string) {
    // PRESENCE, not a count: a turn can repeat a sentence within one
    // conversation (a retry, a queued prompt answered twice), so a scenario
    // asserting "exactly one agent row ever said this" would be asserting
    // something about the shape of the turn rather than about the answer.
    await waitForAtLeastOne(
      this,
      `${TRANSCRIPT} ${ROW}[data-row-kind="${kind}"]:has-text(${JSON.stringify(text)})`,
    );
  },
);

Then(
  "the conductor transcript should show a {string} tool card",
  async function (this: KoluWorld, toolKind: string) {
    await waitForAtLeastOne(this, `${TOOL_CARD}[data-tool-kind="${toolKind}"]`);
  },
);

Then(
  "that tool card should name the terminal {string}",
  async function (this: KoluWorld, name: string) {
    await waitForAtLeastOne(
      this,
      `${TOOL_CARD}:has-text(${JSON.stringify(name)})`,
    );
  },
);

Then(
  "that tool card should name the host {string}",
  async function (this: KoluWorld, host: string) {
    // The card's own host mark, not the card's text: the terminal's name, its
    // cwd and the folded JSON all pass a text match, and the point of this
    // assertion is the column that says WHICH MACHINE.
    await waitForValue(
      "the create card's host mark",
      async () =>
        (
          await this.page
            .locator(`${TOOL_CARD}[data-tool-kind="create"]`)
            .last()
            .locator('[data-testid="conductor-tool-host"]')
            .textContent()
        )?.trim() ?? "absent",
      host,
    );
  },
);

Then(
  "that tool card should offer to open its tile",
  async function (this: KoluWorld) {
    await waitForAtLeastOne(
      this,
      `${TOOL_CARD} [data-testid="conductor-tool-open-tile"]`,
    );
  },
);

When("I open that tool card's tile", async function (this: KoluWorld) {
  await this.page
    .locator(`${TOOL_CARD}[data-tool-kind="create"]`)
    .last()
    .locator('[data-testid="conductor-tool-open-tile"]')
    .click();
});

Then(
  "the adopted terminal should be the focused tile",
  async function (this: KoluWorld) {
    const adopted = this.adoptedTerminalId;
    assert.ok(adopted, "no terminal was adopted in this scenario");
    await waitForValue(
      "the active canvas tile after opening the card's tile",
      async () =>
        (await this.page
          .locator(`${CANVAS_TILE}[data-active]`)
          .getAttribute("data-terminal-id")) ?? "absent",
      adopted,
    );
  },
);

When(
  "I paste an image into the conductor composer",
  async function (this: KoluWorld) {
    // Keep what the browser says from here on. A send that is refused before a
    // row exists leaves nothing in the transcript to read, and the console is
    // where the refusal's own sentence turns up — so the assertion downstream
    // can say WHY nothing was minted rather than only that nothing was.
    const said: string[] = [];
    this.conductorConsole = said;
    this.page.on("console", (message) => {
      said.push(`${message.type()}: ${message.text()}`);
    });

    const input = this.page.locator(INPUT);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.click();
    // A REAL clipboard image, written with the page's own permissions, so the
    // paste the composer handles is a browser paste carrying a `File` — the
    // same event a person's ⌘V produces. Only clipboard-write is needed: the
    // paste event hands the data over without a read.
    await this.page.evaluate(async () => {
      const canvas = new OffscreenCanvas(1, 1);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("OffscreenCanvas getContext('2d') unavailable");
      ctx.fillStyle = "red";
      ctx.fillRect(0, 0, 1, 1);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ]);
    });
    await this.page.keyboard.press(`${MOD_KEY}+v`);
  },
);

Then(
  "the conductor composer should show a settled attachment chip",
  async function (this: KoluWorld) {
    // SETTLED, not merely present: `data-uploading` comes off only when the
    // bytes are on kolu-server under this attachment's own id. A chip that
    // looks ready with nothing behind it is the failure this waits past.
    await waitForAtLeastOne(this, `${CHIP_ATTACHMENT}:not([data-uploading])`);
  },
);

Then(
  "the conductor transcript should show a user row carrying an image attachment",
  async function (this: KoluWorld) {
    const want = `${TRANSCRIPT} ${ROW}[data-row-kind="user"] ${ROW_ATTACHMENT}[data-mime="image/png"]`;
    let rows = "(not observed)";
    // Toasts are ACCUMULATED, not snapshotted. A refusal's toast lives about
    // four seconds and the deadline here is twenty, so the last tick's reading
    // would be an empty screen in exactly the failure this message exists to
    // explain — "no toast" has to mean no toast ever, not none at the end.
    const toasts = new Set<string>();
    await pollFor({
      observe: () => this.page.locator(want).count(),
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        rows = await transcriptInventory(this);
        for (const said of await toastInventory(this)) toasts.add(said);
      },
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `no user row carried an image after ${elapsedMs}ms.\n` +
            `  transcript: ${rows}\n` +
            `  toasts: ${toasts.size === 0 ? "(none, ever)" : [...toasts].join(" | ")}\n` +
            `  console: ${(this.conductorConsole ?? []).slice(-20).join("\n            ") || "(nothing)"}`,
        ),
    });
  },
);

Then(
  "the conductor status should read {string}",
  async function (this: KoluWorld, phase: string) {
    // The phase word on the ONE status line above the composer — the header's
    // chip that used to carry it is gone, so the state lives in one place.
    await waitForValue(
      "the conductor status line's phase",
      async () => (await this.page.locator(PHASE).textContent())?.trim() ?? "",
      phase,
    );
  },
);

Then("the conductor should be asking", async function (this: KoluWorld) {
  await waitForValue(
    "conductor phase",
    async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    "asking",
  );
});

Then("the conductor should not be asking", async function (this: KoluWorld) {
  await pollFor({
    observe: async () =>
      (await this.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    isDone: (phase) => phase !== "asking",
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `conductor phase stayed ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
});

Then(
  "the conductor transcript should mark a user row {string}",
  async function (this: KoluWorld, mark: string) {
    let inventoryAtTimeout = "(not observed)";
    // On timeout, quote what the transcript ACTUALLY holds — the row kinds and
    // the marks that are there. "No row was marked refused" names a symptom;
    // "the rows are user, notice and nothing is marked" names the cause.
    await pollFor({
      observe: () =>
        this.page.locator(`${USER_MARK}[data-mark="${mark}"]`).count(),
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `no user row was marked ${JSON.stringify(mark)} after ${elapsedMs}ms; the transcript holds: ${inventoryAtTimeout}`,
        ),
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
    });
  },
);

Then(
  "the conductor transcript should mark no user row {string}",
  async function (this: KoluWorld, mark: string) {
    await waitForCount(this, `${USER_MARK}[data-mark="${mark}"]`, 0);
  },
);

Then(
  "the conductor roster should show {string} as connected",
  async function (this: KoluWorld, server: string) {
    // THE WHOLE FEATURE IN ONE ASSERTION. The conductor's hands are kolu's
    // own MCP server — the FLEET face now, every terminal on every host — and
    // the only way to know the agent actually has hold of them is the agent's
    // own word about it, which arrives at the START OF A TURN, so this must
    // follow one and never a bare bring-up. Before anything has been said the
    // row reads `handed`, which is the honest "kolu gave this over and nobody
    // has reported either way", and a conductor that silently fell back to
    // running shell commands itself would sit at exactly that.
    //
    // THE ROSTER IS IN THE `⋯` NOW, not a strip above every conversation, so
    // this opens the menu the way a person asking the question does. The
    // panel is portalled and stays up while the poll runs; the second press
    // puts it away so the scenario's next step meets the conversation and not
    // a panel over it.
    const row = `${MENU_PANEL} [data-testid="conductor-server"][data-server="${server}"]`;
    await this.page.locator(MENU).click();
    await this.page
      .locator(MENU_PANEL)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForValue(
      `${row} standing`,
      async () =>
        (await this.page.locator(row).getAttribute("data-standing")) ??
        "absent",
      "connected",
    );
    await this.page.locator(MENU).click();
    await waitForCount(this, MENU_PANEL, 0);
  },
);

/** The folded body of a generic card — the `<pre>` the minified payload lands
 *  in. It is inside a `<details>`, so it has no layout at all until somebody
 *  opens it: a measurement taken while it is shut measures `display: none`
 *  and would pass against the very bug this file is here to catch. */
const TOOL_DETAIL = '[data-testid="conductor-tool-detail"]';

/** Every box from the payload up to the document, with its own width beside
 *  the width of what is inside it. A box whose `scrollWidth` exceeds its
 *  `clientWidth` is one that failed to contain its content; the FIRST such box
 *  walking up is the link that let the line out, and every box above it is a
 *  consequence. Reported on pass as well as on failure — the numbers are the
 *  evidence, not the verdict. */
async function widthChain(world: KoluWorld): Promise<string> {
  return await world.page
    .locator(TOOL_DETAIL)
    .last()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      const rows: string[] = [
        `payload: ${el.textContent?.length ?? 0} chars, white-space=${style.whiteSpace} overflow-wrap=${style.overflowWrap} overflow-x=${style.overflowX}`,
      ];
      for (
        let node: HTMLElement | null = el;
        node !== null;
        node = node.parentElement
      ) {
        const id = node.dataset.testid ?? node.tagName.toLowerCase();
        rows.push(
          `${id}: client=${node.clientWidth} scroll=${node.scrollWidth} offset=${node.offsetWidth}`,
        );
      }
      return rows.join("\n");
    });
}

When(
  "I open that tool card's folded payload",
  async function (this: KoluWorld) {
    const card = this.page.locator(TOOL_CARD).last();
    // A settled call sits in its turn's Details: open that first, the way a
    // reader does, so the card is measured where they meet it — in the fold.
    const fold = this.page.locator(FOLD).filter({ has: card });
    if ((await fold.count()) > 0) await fold.locator("> summary").click();
    await card.locator("summary").last().click();
    await this.page
      .locator(TOOL_DETAIL)
      .last()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "that tool card should keep the payload inside it",
  async function (this: KoluWorld) {
    const chain = await widthChain(this);
    this.log(`width chain (payload → document):\n${chain}`);
    const box = await this.page
      .locator(TOOL_CARD)
      .last()
      .evaluate((el) => {
        const column = el.parentElement?.parentElement ?? null;
        return {
          client: el.clientWidth,
          scroll: el.scrollWidth,
          offset: el.offsetWidth,
          column: column === null ? -1 : column.clientWidth,
        };
      });
    // A pixel of slack for sub-pixel rounding on a fractional device ratio;
    // the bug this guards is thousands of pixels wide, not one.
    assert.ok(
      box.scroll <= box.client + 1,
      `the card's content is ${box.scroll}px wide inside a ${box.client}px card — the payload escaped it\n${chain}`,
    );
    // AND the card itself did not simply GROW to hold the line: a card as wide
    // as its payload contains it perfectly and still pushes the transcript,
    // the pane and the document — the failure the assertion above cannot see.
    assert.ok(
      box.column > 0 && box.offset <= box.column + 1,
      `the card is ${box.offset}px wide in a ${box.column}px transcript — the payload widened the card itself\n${chain}`,
    );
  },
);

Then(
  "that tool card's payload should be readable without scrolling sideways",
  async function (this: KoluWorld) {
    // CONTAINED IS NOT ENOUGH. A block with `overflow-x: auto` holds a 5 KB
    // unbroken line perfectly — 25 000 px of it, reachable only by dragging a
    // scrollbar inside a 970 px card — and a block with `overflow: hidden`
    // simply CUTS it, which loses what the agent read. Both pass the
    // containment assertions above and neither is a readable payload, so this
    // pins the third thing: the line WRAPPED, so every character is on screen.
    const blocks = await this.page
      .locator(`${TOOL_CARD} pre`)
      .evaluateAll((all) =>
        all.map((el) => ({
          id: (el as HTMLElement).dataset.testid ?? "progress",
          client: el.clientWidth,
          scroll: el.scrollWidth,
        })),
      );
    assert.ok(blocks.length > 0, "the card has no payload block at all");
    for (const block of blocks) {
      assert.ok(
        block.scroll <= block.client + 1,
        `${block.id} is ${block.scroll}px wide inside a ${block.client}px block — it did not wrap, so it is readable only by scrolling the block sideways (or, with a hidden overflow, not at all)`,
      );
    }
  },
);

/** WHAT IS STICKING OUT, by name. A document that scrolls sideways says only
 *  that something does; the fix needs the element, so this walks every box and
 *  reports the ones whose right edge is past the window — innermost first,
 *  which is where the line actually escaped. */
async function pastTheWindow(world: KoluWorld): Promise<string> {
  return await world.page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const right = el.getBoundingClientRect().right;
      if (right <= width + 1) continue;
      const id = el.dataset.testid ?? el.tagName.toLowerCase();
      out.push(
        `${id} (${(el.getAttribute("class") ?? "").slice(0, 80)}): right=${Math.round(right)} offset=${el.offsetWidth}`,
      );
    }
    return out.length === 0
      ? "(nothing)"
      : out.reverse().slice(0, 12).join("\n");
  });
}

Then(
  "the page should be no wider than the window",
  async function (this: KoluWorld) {
    const doc = await this.page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    this.log(`past the window (${doc.scroll} vs ${doc.client})`);
    assert.equal(
      doc.scroll,
      doc.client,
      `the document scrolls to ${doc.scroll}px in a ${doc.client}px window — something inside the pane is pushing it wider\n${await pastTheWindow(this)}\n${await widthChain(this)}`,
    );
  },
);

/** THE CHROME BAR'S OWN ARITHMETIC, measured. The row is a flex line whose
 *  only shrinkable member is the host strip; everything else — the identity
 *  rail, the `◆ Conductor alpha` tab ahead of the strip, the control cluster —
 *  is `shrink-0`. So two facts matter and this step pins both: the row FITS the
 *  window, and the strip's own measured width (the budget `computeVisibleHosts`
 *  folds tabs against) is exactly what is LEFT once the others have taken
 *  theirs. The second is the premise the fold rests on — a member that stopped
 *  being counted would make the strip claim room it does not have and the
 *  tabs would run into it instead of folding. */
Then("the chrome bar should fit the window", async function (this: KoluWorld) {
  const bar = await this.page.locator(CHROME_BAR).evaluate((el) => {
    const style = getComputedStyle(el);
    const kids = [...el.children].map((child) => child as HTMLElement);
    return {
      client: el.clientWidth,
      scroll: el.scrollWidth,
      // The row's own geometry, read off the element rather than copied
      // from the markup: padding and the flex gap are what separate the
      // members, and a step that assumed them would pass through a restyle.
      chrome:
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight) +
        Number.parseFloat(style.columnGap) * (kids.length - 1),
      parts: kids.map((kid) => ({
        id:
          kid.dataset.testid ??
          (kid.querySelector("[data-testid]") as HTMLElement | null)?.dataset
            .testid ??
          kid.tagName.toLowerCase(),
        width: kid.getBoundingClientRect().width,
      })),
    };
  });
  const seated = bar.parts.reduce((sum, part) => sum + part.width, 0);
  const report = `chrome bar: client=${bar.client} scroll=${bar.scroll} chrome=${bar.chrome} parts=${bar.parts
    .map((part) => `${part.id}=${Math.round(part.width)}`)
    .join(" ")}`;
  // A host tab's own rendered width, logged beside the budget: it is the
  // number the fold arithmetic is fed, and the one a unit test asserting the
  // five-host fold has to use if it is to mean anything.
  const chip = await this.page
    .locator(HOST_TAB)
    .first()
    .evaluate((el) => Math.round(el.getBoundingClientRect().width))
    .catch(() => -1);
  this.log(`${report} chip=${chip}`);
  assert.ok(
    bar.scroll <= bar.client + 1,
    `the chrome bar's content is ${bar.scroll}px wide in a ${bar.client}px row — ${report}`,
  );
  assert.ok(
    Math.abs(seated + bar.chrome - bar.client) <= 1,
    `the chrome bar's members and its own padding come to ${Math.round(seated + bar.chrome)}px in a ${bar.client}px row — the host strip's budget is not the row's leftover, so the tab fold is computing against room something else is using\n${report}`,
  );
});

/** The terminal's own pill, reused by the conversation: "you are not
 *  following, here is the way back". Scoped under the pane — the same testid
 *  belongs to the scrollback's copy on a host tab. */
const TO_BOTTOM = `${PANE} [data-testid="scroll-to-bottom"]`;

/** The client's own `FOLLOW_SLACK_PX`, which is the number the rule under test
 *  uses. A transcript within a couple of lines of the end IS following; the
 *  failure this file is about leaves it hundreds of pixels short. */
const FOLLOW_SLACK_PX = 48;

/** How far the transcript's last pixel is below the bottom of its view. Zero
 *  (or a line or two) means it is following the conversation. */
async function transcriptGap(world: KoluWorld): Promise<number> {
  return await world.page
    .locator(TRANSCRIPT)
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
}

Then(
  "the conductor transcript should be scrolled to the bottom",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () => transcriptGap(this),
      isDone: (gap) => gap <= FOLLOW_SLACK_PX + 1,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `the transcript is ${last}px below its view after ${elapsedMs}ms — it stopped following the conversation, so the agent is talking off the bottom of the pane`,
        ),
    });
  },
);

When("I scroll the conductor transcript up", async function (this: KoluWorld) {
  const box = await this.page.locator(TRANSCRIPT).boundingBox();
  assert.ok(box !== null, "the transcript has no box to scroll over");
  // A REAL WHEEL over the column, not an assignment to `scrollTop`: the
  // client reads the notch itself (to decide intent before the browser has
  // moved anything), and a scripted scroll would skip that half.
  await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await this.page.mouse.wheel(0, -600);
  // Chromium animates the notch, so the view has not arrived when `wheel`
  // resolves. Wait for it to be demonstrably off the end before anything
  // asserts about where it stays.
  await pollFor({
    observe: () => transcriptGap(this),
    isDone: (gap) => gap > FOLLOW_SLACK_PX + 1,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `the wheel left the transcript ${last}px from its end after ${elapsedMs}ms — it never scrolled up`,
      ),
  });
});

Then(
  "the conductor transcript should stay where the reader left it",
  async function (this: KoluWorld) {
    const top = async () =>
      await this.page.locator(TRANSCRIPT).evaluate((el) => el.scrollTop);
    const before = await top();
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 750);
    await settled.promise;
    const after = await top();
    assert.equal(
      after,
      before,
      `the transcript moved from ${before} to ${after} on its own — a reader who scrolled up to read something was dragged back`,
    );
  },
);

Then(
  "the conductor should offer the way back to the bottom",
  async function (this: KoluWorld) {
    await this.page
      .locator(TO_BOTTOM)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the conductor should not offer the way back to the bottom",
  async function (this: KoluWorld) {
    await waitForCount(this, TO_BOTTOM, 0);
  },
);

When("I take the way back to the bottom", async function (this: KoluWorld) {
  await this.page.locator(TO_BOTTOM).click();
});

// ── Look: the agent line on a create card ──

/** The newest create card's agent line — the status, the toggle and the tail
 *  all live under it. */
const LOOK = `${TOOL_CARD}[data-tool-kind="create"] [data-testid="conductor-look"]`;

Then(
  "that tool card should say how its terminal is doing",
  async function (this: KoluWorld) {
    // `here` is the roster's own word: the terminal was found in the host's
    // mirrored list, with its record — which is what the status line reads.
    await waitForValue(
      "the agent line's standing",
      async () =>
        (await this.page.locator(LOOK).last().getAttribute("data-standing")) ??
        "absent",
      "here",
    );
    const status =
      (await this.page
        .locator(LOOK)
        .last()
        .locator('[data-testid="conductor-look-status"]')
        .textContent()) ?? "";
    assert.ok(
      status.trim() !== "",
      "the agent line says nothing about its terminal",
    );
  },
);

When("I look at that tool card's terminal", async function (this: KoluWorld) {
  await this.page
    .locator(LOOK)
    .last()
    .locator('[data-testid="conductor-look-toggle"]')
    .click();
});

Then(
  "the look should show {string}",
  async function (this: KoluWorld, text: string) {
    // What the tail ACTUALLY says on timeout — "reading the screen…", a
    // failed read's sentence, or lines without the marker are three different
    // bugs, and a bare "nothing matched" names none of them.
    await pollFor({
      observe: async () =>
        (
          (await this.page
            .locator(`${LOOK} [data-testid="conductor-look-tail"]`)
            .last()
            .textContent({ timeout: 1_000 })
            .catch(() => null)) ?? "(no tail)"
        )
          .replace(/\s+/g, " ")
          .trim(),
      isDone: (seen) => seen.includes(text),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `the look never showed ${JSON.stringify(text)}; after ${elapsedMs}ms it said ${JSON.stringify(last)}`,
        ),
    });
  },
);

Then(
  "that tool card should say its terminal is gone",
  async function (this: KoluWorld) {
    await waitForValue(
      "the agent line's status",
      async () =>
        (
          await this.page
            .locator(LOOK)
            .last()
            .locator('[data-testid="conductor-look-status"]')
            .textContent()
        )?.trim() ?? "absent",
      "terminal gone",
    );
    // Nothing to look at: the toggle, and with it every read, is gone too.
    await waitForCount(
      this,
      `${LOOK} [data-testid="conductor-look-toggle"]`,
      0,
    );
    await waitForCount(this, `${LOOK} [data-testid="conductor-look-tail"]`, 0);
  },
);

// ── The Details fold ──

const FOLD = `${TRANSCRIPT} [data-testid="conductor-fold"]`;

/** How many of the matches are actually on screen — a closed `<details>`
 *  keeps its rows in the DOM, so a count alone cannot tell folded from shown. */
async function visibleCount(
  world: KoluWorld,
  selector: string,
): Promise<number> {
  return world.page
    .locator(selector)
    .evaluateAll((all) => all.filter((el) => el.checkVisibility()).length);
}

Then(
  "the conductor transcript should fold {int} tool calls into one closed Details",
  async function (this: KoluWorld, count: number) {
    // Waited for, not read once: the fold grows as calls settle, so it can be
    // on screen at a smaller count first.
    await waitForCount(this, FOLD, 1);
    const fold = this.page.locator(FOLD);
    await waitForValue(
      "the Details fold's count",
      async () => (await fold.getAttribute("data-count")) ?? "absent",
      String(count),
    );
    assert.strictEqual(
      await fold.evaluate((el) => (el as HTMLDetailsElement).open),
      false,
      "the Details fold should start closed",
    );
    assert.strictEqual(await visibleCount(this, `${FOLD} ${TOOL_CARD}`), 0);
  },
);

/** The card status each phrase names — a failure is news, a running call keeps
 *  its clock in view; neither is ever folded away. */
const IN_FLOW_STATUS: Record<string, string> = {
  failed: "failed",
  running: "in_progress",
};

Then(
  "the {word} tool call should stay in the flow",
  async function (this: KoluWorld, which: string) {
    const status = IN_FLOW_STATUS[which];
    assert.ok(status !== undefined, `no tool-call status is named "${which}"`);
    // A DIRECT row of the transcript, not one inside the fold: a reader must
    // not have to open anything to see it.
    await waitForValue(
      `${which} tool cards outside the fold`,
      async () =>
        String(
          await visibleCount(
            this,
            `${TRANSCRIPT} > ${ROW} ${TOOL_CARD}[data-status="${status}"]`,
          ),
        ),
      "1",
    );
  },
);

When("I open the Details fold", async function (this: KoluWorld) {
  await this.page.locator(`${FOLD} > summary`).click();
});

Then(
  "the Details fold should show its {int} tool calls",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "tool cards shown inside the open fold",
      async () => String(await visibleCount(this, `${FOLD} ${TOOL_CARD}`)),
      String(count),
    );
  },
);

Then(
  "the Details fold should still be open, holding {int} tool calls",
  async function (this: KoluWorld, count: number) {
    // The same `<details>` element, not a fresh one: a fold re-created when a
    // call joined it or prose closed it would be back to closed.
    const fold = this.page.locator(FOLD);
    await waitForValue(
      "the Details fold's count",
      async () => (await fold.getAttribute("data-count")) ?? "absent",
      String(count),
    );
    assert.strictEqual(
      await fold.evaluate((el) => (el as HTMLDetailsElement).open),
      true,
      "the Details fold a person opened should still be open",
    );
  },
);

// ── The Conductor on a phone ──

Then(
  "the mobile chrome sheet should put the conductor first, lit, and no host lit",
  async function (this: KoluWorld) {
    // The sheet IS the phone's tab row, so it keeps the row's rules: the
    // conversation first, and exactly one place lit — the one you are in.
    const tab = this.page.locator(`${MOBILE_SHEET} ${TAB}`);
    await waitForValue(
      "the sheet's conductor entry lit",
      async () => (await tab.getAttribute("data-active")) ?? "absent",
      "",
    );
    const hosts = this.page.locator(
      `${MOBILE_SHEET} [data-testid="mobile-host-chip"]`,
    );
    const entry = await tab.boundingBox();
    const firstHost = await hosts.first().boundingBox();
    assert.ok(entry !== null && firstHost !== null, "the sheet is not drawn");
    assert.ok(
      entry.y + entry.height <= firstHost.y,
      `the conductor entry (y=${entry.y}) is not above the host chips (y=${firstHost.y})`,
    );
    assert.equal(
      await this.page
        .locator(
          `${MOBILE_SHEET} [data-testid="mobile-host-chip"][data-active]`,
        )
        .count(),
      0,
      "a host chip is lit while the conversation is the current place",
    );
  },
);

Then(
  "nothing on screen should reach past the window's right edge",
  async function (this: KoluWorld) {
    // Stricter than "the page is no wider than the window": a span clipped by
    // an `overflow: hidden` ancestor keeps the document narrow while its own
    // box runs off the screen — exactly how a phone's agent line used to cut
    // its title. Every element with a box is measured.
    const offenders = await this.page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            box.right > window.innerWidth + 0.5
          );
        })
        .slice(0, 5)
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}${el.dataset.testid ? `[data-testid="${el.dataset.testid}"]` : ""} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent ?? "").trim().slice(0, 40)}"`,
        ),
    );
    assert.deepEqual(
      offenders,
      [],
      `elements reach past the ${await this.page.evaluate(() => window.innerWidth)}px window:\n${offenders.join("\n")}`,
    );
  },
);

// ── The Conductor never blocks: wakes, the work column, the status line ──
//
// A member terminal's agent state comes from the same mocked Claude Code
// session files the agent-detection scenarios write, so a wake here travels
// padi's urgency fold, kolu-server's watcher and the ACP wire to the scripted
// adapter — nothing in the browser is told about it except by the cells and
// the transcript, which is exactly what a person reads.

const STATUS = '[data-testid="conductor-status"]';
/** The status line's one readout about the work: `data-work` pieces of work in
 *  progress, `data-waiting` things waiting on you. Each attribute is ABSENT at
 *  zero and the whole element is absent when both are — nothing here reads 0.
 *  Below the two-column width it is also the control that opens the column. */
const WORK_COUNT = '[data-testid="conductor-work-count"]';
const HELD = '[data-testid="conductor-held"]';
/** The column of work — the same component in both placements (the pane's
 *  second track on a wide window, the band the status line's control opens
 *  below that width). */
const WORK_COLUMN = '[data-testid="work-column"]';
const WORK_CARD = '[data-testid="work-card"]';
const WORK_MEMBER = '[data-testid="work-member"]';
const WAKE_ROW = `${ROW}[data-row-kind="wake"]`;
const STEER_HINT = '[data-testid="conductor-steer-hint"]';

/** The number in an element's text — `2 waiting` — or `absent` when the
 *  element is not on screen, so a failure says which. */
async function countIn(world: KoluWorld, selector: string): Promise<string> {
  const node = world.page.locator(selector);
  if ((await node.count()) === 0) return "absent";
  const text = (await node.first().textContent()) ?? "";
  return text.match(/\d+/)?.[0] ?? `no number in ${JSON.stringify(text)}`;
}

/** The terminal this scenario put into a work, or a failure saying it never
 *  did — every step below is about THAT terminal. */
function watchedId(world: KoluWorld): string {
  const id = world.watchedTerminalId;
  assert.ok(id, "no terminal was joined to a work in this scenario");
  return id;
}

/** That terminal's member row on the column: a member's ref is `<host>/<id>`,
 *  and the id half is the one this scenario knows. */
function memberRow(world: KoluWorld) {
  return world.page.locator(
    `${WORK_COLUMN} ${WORK_MEMBER}[data-ref$="/${watchedId(world)}"]`,
  );
}

/** A PLAIN WATCH the human asked for opens a piece of work of its own, titled
 *  `watch <id>` by the fixture. Noting that title is what keeps a scenario
 *  about ITS card: the suite's worker shares one server, and a work another
 *  scenario opened is still in the column. */
function noteWatchWork(world: KoluWorld, id: string): void {
  world.watchedTerminalId = id;
  world.workTitle = `watch ${id}`;
}

When(
  "I ask the conductor to watch the terminal",
  async function (this: KoluWorld) {
    // THE FOCUSED tile, read before the conversation covers the canvas — the
    // same reading `adopt the terminal I am in` makes, for the same reason.
    const id = await this.page
      .locator(`${CANVAS_TILE}[data-active]`)
      .getAttribute("data-terminal-id", { timeout: POLL_TIMEOUT });
    assert.ok(id, "no tile is focused, so there is nothing to watch");
    noteWatchWork(this, id);
    await enterConductor(this);
    // The fixture answers `watch <id>` with a REAL work opened in `watch` mode
    // and a `work_adopt` of that terminal — so the column moves because the
    // tools moved it.
    await sendPrompt(this, `watch ${id}`);
  },
);

When(
  "I ask the conductor to watch the first terminal",
  async function (this: KoluWorld) {
    // The PHONE's spelling: no canvas tile is focused there, so the terminal
    // is read off the roster the same way `adopt the terminal` reads it.
    const ids = await this.terminalIds();
    const id = ids[0];
    assert.ok(id, "a terminal must exist before the conductor can watch one");
    noteWatchWork(this, id);
    await enterConductor(this);
    await sendPrompt(this, `watch ${id}`);
  },
);

When(
  "I ask the conductor to watch the terminal I just created",
  async function (this: KoluWorld) {
    // The id the CREATE answered with, not whichever tile the canvas has
    // focused: a scenario that watches two terminals in a row is asking for
    // two particular ones, and the focus is a different fact.
    const id = this.createdTerminalIds.at(-1);
    assert.ok(id, "no terminal was created in this scenario");
    noteWatchWork(this, id);
    await enterConductor(this);
    await sendPrompt(this, `watch ${id}`);
  },
);

/** THE ONE READOUT the status line keeps about the work, read off its own
 *  data rather than out of its sentence: `data-work` is how many pieces of
 *  work are in progress, `data-waiting` how many things wait on you. Both are
 *  ABSENT at zero (nothing here reads `0`), and so is the element itself when
 *  neither has anything to say — which is why each reading answers `absent`
 *  rather than throwing on a missing node. */
async function workReadout(
  world: KoluWorld,
  attribute: "data-work" | "data-waiting",
): Promise<string> {
  const node = world.page.locator(`${STATUS} ${WORK_COUNT}`);
  if ((await node.count()) === 0) return "absent";
  return (await node.getAttribute(attribute)) ?? "absent";
}

Then(
  "the conductor status should say {int} piece(s) of work",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "the status line's pieces of work",
      () => workReadout(this, "data-work"),
      String(count),
    );
  },
);

Then(
  "the conductor status should say {int} waiting on you",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "the status line's waiting-on-you count",
      () => workReadout(this, "data-waiting"),
      String(count),
    );
  },
);

Then(
  "the conductor status should say nothing is waiting on you",
  async function (this: KoluWorld) {
    // ABSENT, never `0`: a part of the line that would read a quantity of
    // nothing is not drawn at all.
    await waitForValue(
      "the status line's waiting-on-you count",
      () => workReadout(this, "data-waiting"),
      "absent",
    );
  },
);

Then(
  "the conductor status should say nothing is in progress",
  async function (this: KoluWorld) {
    await waitForCount(this, `${STATUS} ${WORK_COUNT}`, 0);
  },
);

Then(
  "the conductor status should say {int} waiting",
  async function (this: KoluWorld, count: number) {
    await waitForValue(
      "the status line's waiting count",
      () => countIn(this, `${STATUS} ${HELD}`),
      String(count),
    );
  },
);

Then(
  "the conductor status should say nothing is waiting",
  async function (this: KoluWorld) {
    await waitForCount(this, `${STATUS} ${HELD}`, 0);
  },
);

Then(
  "the conductor transcript should show no wake",
  async function (this: KoluWorld) {
    // AN INSTANT, not a wait: the claim is about NOW — the turn is running and
    // the wake is held — and a poll for zero would pass the moment before one
    // was wrongly injected.
    assert.equal(
      await this.page.locator(WAKE_ROW).count(),
      0,
      `a wake landed while the turn ran: ${await transcriptInventory(this)}`,
    );
  },
);

Then(
  "the conductor transcript should show a wake about the watched terminal",
  async function (this: KoluWorld) {
    const id = watchedId(this);
    // The ACCOUNT names the terminal by its fleet ref; it is in the DOM even
    // folded (the disclosure hides it, it does not withhold it) — so the
    // wake is matched on the terminal it is about, not merely on existing.
    let inventoryAtTimeout = "(not observed)";
    await pollFor({
      observe: () =>
        this.page
          .locator(WAKE_ROW)
          .evaluateAll(
            (rows, want) =>
              rows.filter((row) => (row.textContent ?? "").includes(want))
                .length,
            `/${id}`,
          ),
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `no wake about ${id} after ${elapsedMs}ms; the transcript holds ${inventoryAtTimeout}`,
        ),
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
    });
  },
);

Then(
  "the conductor transcript should show a {string} wake about the watched terminal",
  async function (this: KoluWorld, level: string) {
    const id = watchedId(this);
    let inventoryAtTimeout = "(not observed)";
    // The LEVEL is read off the wake's own `data-levels`, not its wording:
    // which words the line uses is the panel's business, which fact rang is
    // the server's.
    await pollFor({
      observe: () =>
        this.page
          .locator(`${WAKE_ROW} [data-testid="conductor-wake"]`)
          .evaluateAll(
            (wakes, want) =>
              wakes.filter(
                (wake) =>
                  (wake.getAttribute("data-levels") ?? "")
                    .split(" ")
                    .includes(want.level) &&
                  (wake.textContent ?? "").includes(want.ref),
              ).length,
            { level, ref: `/${id}` },
          ),
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, elapsedMs) =>
        new Error(
          `no ${JSON.stringify(level)} wake about ${id} after ${elapsedMs}ms; the transcript holds ${inventoryAtTimeout}`,
        ),
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
    });
  },
);

Then("the wake should be one line from kolu", async function (this: KoluWorld) {
  const wake = this.page.locator(WAKE_ROW).last();
  const headline = wake.locator('[data-testid="conductor-wake-headline"]');
  await headline.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  assert.match((await wake.textContent()) ?? "", /kolu/);
  assert.equal(
    await wake.locator('[data-testid="conductor-wake-text"]').isVisible(),
    false,
    "the wake's whole account was open before anybody opened it",
  );
  // The machine's line is NOT the human's bubble — a user mark (and the
  // send-again that rides it) belongs to words a person typed.
  assert.equal(await wake.locator(USER_MARK).count(), 0);
});

/** THE CONVERSATION STARTS AN AGENT. The fixture's `run <command>` makes a real
 *  `lifecycle_create` on the fleet face with that command typed at the new
 *  terminal's first prompt — and the tool watches what it created, so this one
 *  step produces a watched terminal whose agent comes up on its own.
 *
 *  The command is built HERE because only the test process knows the stand-in's
 *  absolute path (the harness seeds a renamed bash per worker as
 *  `KOLU_FAKE_OMP_BIN`, so `/proc/<pid>/comm` reads `omp`), and because the
 *  stand-in must be the LAZY one: it writes its breadcrumb at launch and its
 *  session file only when something prompts it. Between those two moments the
 *  terminal is an agent with no transcript, which is the whole subject of the
 *  scenario.
 *
 *  The terminal it answers with becomes this scenario's watched terminal, so
 *  every `… about the watched terminal` assertion below is about the one the
 *  conversation itself started. */
When(
  "I ask the conductor to run an agent in a new terminal",
  async function (this: KoluWorld) {
    const bin = process.env.KOLU_FAKE_OMP_BIN;
    if (!bin) throw new Error("KOLU_FAKE_OMP_BIN must be set");
    const ompDir = process.env.KOLU_OMP_DIR;
    if (!ompDir) throw new Error("KOLU_OMP_DIR must be set");
    conductorAgentCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), `kolu-conductor-omp-${process.pid}-`),
    );
    const fixture = ompTranscriptPath({ ompDir, cwd: conductorAgentCwd });
    const stagePath = path.join(conductorAgentCwd, "omp-session-pending.jsonl");
    // What its FIRST prompt writes: a session already thinking, which is what
    // a real omp's first prompt leaves on disk — so `agent_say`'s "did it
    // take" question has a true answer to find.
    stageOmpPrompt(stagePath, "thinking");
    const payload = ompMockPayload({
      breadcrumbDir: path.join(ompDir, "terminal-sessions"),
      transcriptPath: fixture.transcriptPath,
      stagePath,
    });
    await enterConductor(this);
    await sendPrompt(this, `run ${bin} -c '${payload}'`);
    // The create's own answer names the terminal — read off the row the agent
    // said it in, so the scenario watches the terminal that really was made
    // rather than whichever id the canvas happens to show.
    let inventoryAtTimeout = "(not observed)";
    const said = await pollFor({
      observe: async () => {
        const rows = await this.page
          .locator(`${TRANSCRIPT} ${ROW}[data-row-kind="agent"]`)
          .evaluateAll((all) => all.map((row) => row.textContent ?? ""));
        for (const text of rows) {
          const ref = /ran:[\s\S]*?\blocal\/([0-9a-f-]{36})\b/.exec(text);
          if (ref?.[1]) return ref[1];
        }
        return null;
      },
      isDone: (ref) => ref !== null,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
      onTimeout: (_last, ms) =>
        new Error(
          `the conductor never answered with a terminal it ran an agent in after ${ms}ms; the transcript holds ${inventoryAtTimeout}`,
        ),
    });
    if (said === null) throw new Error("no terminal ref was answered");
    this.watchedTerminalId = said;
  },
);

/** RINGS ONCE. The claim is about repetition, so it is read after the wake has
 *  landed AND the conversation has been left alone long enough for a second
 *  one to arrive: a bare count taken the instant the first lands would pass
 *  against a server that rings every tick. */
Then(
  "the conductor transcript should show exactly one {string} wake about the watched terminal",
  async function (this: KoluWorld, level: string) {
    const id = watchedId(this);
    const count = async (): Promise<number> =>
      this.page
        .locator(`${WAKE_ROW} [data-testid="conductor-wake"]`)
        .evaluateAll(
          (wakes, want) =>
            wakes.filter(
              (wake) =>
                (wake.getAttribute("data-levels") ?? "")
                  .split(" ")
                  .includes(want.level) &&
                (wake.textContent ?? "").includes(want.ref),
            ).length,
          { level, ref: `/${id}` },
        );
    let inventoryAtTimeout = "(not observed)";
    await pollFor({
      observe: count,
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
      onTimeout: (_last, ms) =>
        new Error(
          `no ${JSON.stringify(level)} wake about ${id} after ${ms}ms; the transcript holds ${inventoryAtTimeout}`,
        ),
    });
    // Then LEAVE IT ALONE. A wake that repeats does so on the server's own
    // re-report cadence, which is seconds wide, so a count taken the instant
    // the first one lands would pass against a server that rings every tick.
    const quiet = Promise.withResolvers<void>();
    setTimeout(quiet.resolve, REPEAT_WAKE_WINDOW_MS);
    await quiet.promise;
    assert.equal(
      await count(),
      1,
      `the agent that came up rang ${JSON.stringify(level)} more than once`,
    );
  },
);

/** SPEAK TO IT — the fixture's `tell it <words>`, which is a real `agent_say`
 *  on the fleet face against the terminal the conversation started. */
When(
  "I ask the conductor to tell the agent {string}",
  async function (this: KoluWorld, words: string) {
    await enterConductor(this);
    await sendPrompt(this, `tell it ${words}`);
  },
);

When("I open the wake", async function (this: KoluWorld) {
  await this.page
    .locator(WAKE_ROW)
    .last()
    .locator('[data-testid="conductor-wake-toggle"]')
    .click();
});

Then(
  "the wake should give the whole account of the watched terminal",
  async function (this: KoluWorld) {
    const text = this.page
      .locator(WAKE_ROW)
      .last()
      .locator('[data-testid="conductor-wake-text"]');
    await text.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.match(
      (await text.textContent()) ?? "",
      new RegExp(`local/${watchedId(this)}`),
    );
  },
);

/** PUT THE COLUMN ON SCREEN, however this window holds it. On a window wide
 *  enough for two columns it is already beside the conversation and there is
 *  nothing to press — the status line carries a readout there, not a control.
 *  Below that width it is the band the control opens. Either way the step
 *  means the same thing: the work is readable now. */
async function showWorkColumn(world: KoluWorld): Promise<void> {
  if ((await world.page.locator(WORK_COLUMN).count()) === 0) {
    await world.page.locator(`${STATUS} ${WORK_COUNT}`).click();
  }
  await world.page
    .locator(WORK_COLUMN)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

/** THE CARD THIS SCENARIO IS ABOUT, by the narrowest thing it knows: the id
 *  it read off the card when it opened the work, else the title it gave it,
 *  else the column's one card.
 *
 *  The title fallback is not politeness. A WORK OUTLIVES THE CONVERSATION
 *  (that is the feature), and the suite's worker shares one server across
 *  every scenario in a file — so the column a later scenario meets can hold
 *  a card an earlier one opened, and `first()` would quietly be about that
 *  one instead. */
function workCard(world: KoluWorld) {
  const id = world.workId;
  if (id !== undefined)
    return world.page.locator(`${WORK_COLUMN} ${WORK_CARD}[data-work="${id}"]`);
  const cards = world.page.locator(`${WORK_COLUMN} ${WORK_CARD}`);
  const title = world.workTitle;
  return title === undefined
    ? cards.first()
    : cards.filter({ hasText: title }).first();
}

/** Open that card, idempotently — a card already open is left alone, because
 *  pressing its head would SHUT it and every later step would read an empty
 *  card and blame the product.
 *
 *  A work that has ENDED is below the line in the collapsed `Finished`
 *  section: the SAME card, one disclosure further, so the step that opens a
 *  card means the same thing before and after the work finished. */
async function openWorkCard(world: KoluWorld): Promise<void> {
  await showWorkColumn(world);
  const card = workCard(world);
  if (!(await card.isVisible().catch(() => false))) {
    const finished = world.page.locator(
      `${WORK_COLUMN} [data-testid="work-finished"]`,
    );
    if ((await finished.count()) > 0) await openFinished(world);
  }
  await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  if ((await card.getAttribute("data-open")) === null) {
    await card.locator('[data-testid="work-card-head"]').click();
  }
  await waitForValue(
    "the work card's open state",
    async () => (await card.getAttribute("data-open")) ?? "absent",
    "",
  );
}

When("I open the work column", async function (this: KoluWorld) {
  await showWorkColumn(this);
});

When("I open the work card", async function (this: KoluWorld) {
  await openWorkCard(this);
});

Then("the work column should show the work", async function (this: KoluWorld) {
  // WHEREVER the column is standing — beside the conversation on a wide
  // window, behind the status line's control below that width — the work is
  // in it.
  await showWorkColumn(this);
  await workCard(this).waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the work column should list the terminal as a member",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    await memberRow(this).waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I look at the member terminal", async function (this: KoluWorld) {
  await memberRow(this).locator('[data-testid="work-member-look"]').click();
});

When("I press the member terminal's name", async function (this: KoluWorld) {
  // THE MEMBER'S NAME IS THE WAY TO THE TERMINAL — the same journey the create
  // card's *open tile* makes, which is why the assertion below is the one that
  // step's scenario makes about the tile it lands on.
  await memberRow(this).locator('[data-testid="work-member-name"]').click();
});

Then(
  "the member terminal should be the focused tile",
  async function (this: KoluWorld) {
    const id = watchedId(this);
    await waitForValue(
      "the active canvas tile after pressing the member's name",
      async () =>
        (await this.page
          .locator(`${CANVAS_TILE}[data-active]`)
          .getAttribute("data-terminal-id")) ?? "absent",
      id,
    );
  },
);

Then(
  "the member terminal's look should show {string}",
  async function (this: KoluWorld, text: string) {
    await pollFor({
      observe: async () =>
        (
          (await this.page
            .locator(`${WORK_COLUMN} [data-testid="conductor-look-tail"]`)
            .last()
            .textContent({ timeout: 1_000 })
            .catch(() => null)) ?? "(no tail)"
        )
          .replace(/\s+/g, " ")
          .trim(),
      isDone: (seen) => seen.includes(text),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `the member's look never showed ${JSON.stringify(text)}; after ${elapsedMs}ms it said ${JSON.stringify(last)}`,
        ),
    });
  },
);

// ── One reading column, and the side column beside it ──
//
// The work column has TWO placements and one implementation: a side column
// that is always on screen on a window wide enough for both measures, and the
// band the status line's control opens below that width. These steps say
// which placement is live, because that is the thing a person sees change.

/** The pane's second column — the always-on placement of the work column. */
const SIDE = '[data-testid="conductor-side"]';

Then(
  "the conductor side column should show the work",
  async function (this: KoluWorld) {
    const id = this.workId;
    await this.page
      .locator(
        `${SIDE} ${WORK_CARD}${id === undefined ? "" : `[data-work="${id}"]`}`,
      )
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the conductor should have no side column",
  async function (this: KoluWorld) {
    await waitForCount(this, SIDE, 0);
  },
);

Then(
  "the work column should be behind the status line's control",
  async function (this: KoluWorld) {
    // The narrow window's bargain: the work is not standing beside the
    // conversation, and the way to it is the count on the status line.
    await waitForCount(this, WORK_COLUMN, 0);
    await this.page
      .locator(`${STATUS} ${WORK_COUNT}`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the work column should say nothing is in progress",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${SIDE} [data-testid="work-column-empty"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then("no count on screen should read zero", async function (this: KoluWorld) {
  // Every readout the conversation keeps about its own work — the status
  // line and the side column — read whole, and none of them may say `0`.
  // A zero here is not a small cosmetic thing: it is the conversation
  // reporting a quantity of nothing, which a reader has to parse before
  // they can ignore it.
  const zeros = await this.page.evaluate(
    ([status, side]) =>
      [...document.querySelectorAll<HTMLElement>(`${status}, ${side}`)]
        .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter((text) => /\b0\b/.test(text)),
    [STATUS, SIDE],
  );
  assert.deepEqual(zeros, [], `a readout says zero: ${zeros.join(" / ")}`);
});

Then("the conductor should offer to steer", async function (this: KoluWorld) {
  await this.page
    .locator(STEER_HINT)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

When(
  "I steer the conductor with {string}",
  async function (this: KoluWorld, text: string) {
    const input = this.page.locator(INPUT);
    await input.click();
    await input.fill(text);
    await this.page.keyboard.press("Alt+Enter");
  },
);

Then(
  "the conductor status should count how long it has been working",
  async function (this: KoluWorld) {
    await pollFor({
      observe: async () =>
        (
          (await this.page
            .locator(`${STATUS} [data-testid="conductor-status-since"]`)
            .textContent({ timeout: 1_000 })
            .catch(() => null)) ?? "(absent)"
        ).trim(),
      isDone: (seen) => /\d+\s*(s|m|h)/.test(seen),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, elapsedMs) =>
        new Error(
          `the status line never counted the turn; after ${elapsedMs}ms it said ${JSON.stringify(last)}`,
        ),
    });
  },
);

Then(
  "the conductor header should carry no state chip",
  async function (this: KoluWorld) {
    // The state lives in ONE place — the status line above the composer — so
    // the only `conductor-phase` on screen is the status line's.
    const phases = this.page.locator(PHASE);
    assert.equal(await phases.count(), 1);
    assert.equal(await this.page.locator(`${STATUS} ${PHASE}`).count(), 1);
  },
);

When("I mark the conductor pane", async function (this: KoluWorld) {
  // A JS EXPANDO, not a `data-` attribute: an attribute is markup, and a pane
  // rebuilt from the same JSX would come back wearing it. A property set on
  // the node by hand exists only on THAT object, so finding it again is proof
  // the element itself survived — the identity check `/solidjs` asks for.
  //
  // The value is built here, at run time, so it cannot be anything the page's
  // own source could have put there.
  const marker = `kolu-pane-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  this.conductorPaneMarker = marker;
  const pane = this.page.locator(PANE);
  await pane.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await pane.evaluate((el, value) => {
    (el as HTMLElement & { koluPaneMarker?: string }).koluPaneMarker = value;
  }, marker);
});

Then(
  "the conductor pane should be the one I marked",
  async function (this: KoluWorld) {
    const marker = this.conductorPaneMarker;
    assert.ok(marker, "no conductor pane was marked");
    const pane = this.page.locator(PANE);
    await pane.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const found = await pane.evaluate(
      (el) => (el as HTMLElement & { koluPaneMarker?: string }).koluPaneMarker,
    );
    assert.equal(
      found,
      marker,
      found === undefined
        ? "the conductor pane came back as a NEW element — it was rebuilt rather than retained, so everything that was open in it was thrown away"
        : `the conductor pane carries ${JSON.stringify(found)}, not the marker ${JSON.stringify(marker)}`,
    );
  },
);

Then(
  "the conductor composer should still hold {string}",
  async function (this: KoluWorld, text: string) {
    await waitForValue(
      "the conductor composer's text after the round trip",
      () => this.page.locator(INPUT).inputValue(),
      text,
    );
  },
);

When(
  "I type {string} into the conductor without sending",
  async function (this: KoluWorld, text: string) {
    const input = this.page.locator(INPUT);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.click();
    await input.fill(text);
  },
);

// ── The help: a column in the gutter, a sheet from the menu ──
//
// One set of words in two frames (`helpContent.ts`). These steps never read
// the sentences themselves — a help text is meant to be reworded — they read
// the SECTIONS it promises and which frame they arrived in, so a rewrite
// passes and a section quietly dropped does not.

const HELP = '[data-testid="conductor-help"]';
const HELP_TOGGLE = '[data-testid="conductor-help-toggle"]';
const HELP_CONTENT = '[data-testid="conductor-help-content"]';
const HELP_SECTION = '[data-testid="conductor-help-section"]';
const HELP_SHEET = '[data-testid="conductor-help-sheet"]';
const MENU_HELP = '[data-testid="conductor-menu-help"]';

/** The sections the panel promises, in order — the id each section rides as
 *  data, not its heading, so rewording a heading is not a broken test. */
const HELP_SECTIONS = [
  "ask",
  "waterfall",
  "while-it-works",
  "the-card",
  "terminals",
  "files",
  "mid-work",
  "wakes",
  "asks",
];

/** What one copy of the help is showing, as `id,id,…` — or why it is not
 *  readable, so a failure says which. */
async function helpSectionsIn(
  world: KoluWorld,
  placement: "column" | "sheet",
): Promise<string> {
  const copy = `${HELP_CONTENT}[data-placement="${placement}"]`;
  if ((await world.page.locator(copy).count()) === 0) {
    return `no ${placement} copy of the help is on screen`;
  }
  return (
    await world.page
      .locator(`${copy} ${HELP_SECTION}`)
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).dataset.section ?? "unnamed"),
      )
  ).join(",");
}

Then(
  "the conductor help column should be open",
  async function (this: KoluWorld) {
    await waitForValue(
      "the help column's open state",
      async () =>
        (await this.page.locator(HELP).getAttribute("data-open")) ?? "absent",
      "true",
    );
  },
);

Then(
  "the conductor help column should be a rail with one way back in",
  async function (this: KoluWorld) {
    await waitForValue(
      "the help column's open state",
      async () =>
        (await this.page.locator(HELP).getAttribute("data-open")) ?? "absent",
      "false",
    );
    // Collapsed it carries its words no longer, and exactly one control.
    await waitForCount(this, `${HELP} ${HELP_CONTENT}`, 0);
    await waitForCount(this, `${HELP} ${HELP_TOGGLE}`, 1);
  },
);

Then(
  "the conductor should have no help column",
  async function (this: KoluWorld) {
    await waitForCount(this, HELP, 0);
  },
);

When("I collapse the conductor help", async function (this: KoluWorld) {
  await this.page.locator(`${HELP} ${HELP_TOGGLE}`).click();
});

When("I reopen the conductor help", async function (this: KoluWorld) {
  await this.page.locator(`${HELP} ${HELP_TOGGLE}`).click();
});

When(
  "I open How to use from the conductor menu",
  async function (this: KoluWorld) {
    await this.page.locator(MENU).click();
    await waitForAtLeastOne(this, MENU_PANEL);
    await this.page.locator(MENU_HELP).click();
  },
);

Then(
  "the conductor menu should not offer How to use",
  async function (this: KoluWorld) {
    // Where the help is already a column, the menu entry would be a second
    // door to the words standing open beside it.
    await this.page.locator(MENU).click();
    await waitForAtLeastOne(this, MENU_PANEL);
    await waitForCount(this, MENU_HELP, 0);
    await this.page.locator(MENU).click();
    await waitForCount(this, MENU_PANEL, 0);
  },
);

Then(
  "the help {word} should teach the conversation, docs and all",
  async function (this: KoluWorld, placement: string) {
    assert.ok(
      placement === "column" || placement === "sheet",
      `the help has no ${placement} placement`,
    );
    await waitForValue(
      `the sections of the help's ${placement}`,
      () => helpSectionsIn(this, placement),
      HELP_SECTIONS.join(","),
    );
    const docs = this.page.locator(
      `${HELP_CONTENT}[data-placement="${placement}"] [data-testid="conductor-help-docs"]`,
    );
    await docs.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.match(
      (await docs.getAttribute("href")) ?? "",
      /\/conductor\/$/,
      "the help's Full docs link does not point at the Conductor's own page",
    );
  },
);

Then("the help sheet should be open", async function (this: KoluWorld) {
  await this.page
    .locator(HELP_SHEET)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

// ── A piece of work: the repo it is done in, its members, its files, its PR ──
//
// Everything a scenario below states, it states WHERE KOLU READS IT: a file in
// the worktree, the transcript the member's agent session really has, a pull
// request the repo's own `gh` answers with. Nothing here writes to the work
// record — the whole claim of these scenarios is that the timeline grows from
// what kolu observed, so a step that poked the record would be asserting its
// own write.

/** The scratch repos this scenario made, and the session file of the agent in
 *  its member terminal. Module state rather than world state because the After
 *  hook that reaps them has no scenario-shaped work to do. */
const workRepos: string[] = [];
let memberFixture: { transcriptPath: string; sessionId: string } | null = null;
/** How many times the repo's branch has been moved to hurry the PR sensor —
 *  each move needs a name no earlier one used. */
let branchBumps = 0;
/** The pull request the scenario has stated so far, so a step that changes one
 *  thing about it (its checks, its state) restates the rest unchanged. */
let statedPr: PrFixture | null = null;

After(() => {
  for (const dir of workRepos) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  workRepos.length = 0;
  memberFixture = null;
  branchBumps = 0;
  statedPr = null;
});

function workRepo(world: KoluWorld): string {
  const dir = world.workRepoDir;
  assert.ok(dir, "this scenario never made a repo for its work");
  return dir;
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "ignore" });
}

/** A REAL REPOSITORY for the work: a branch to be on, a commit to be at, and
 *  an `origin` on `github.com` — which is the fact `detectForge` routes on, so
 *  the PR sensor reaches the gh adapter at all. The remote is never dialled:
 *  the suite's `gh` answers from the repo's own fixture file. */
Given("a repo for the work", async function (this: KoluWorld) {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), `kolu-work-repo-${process.pid}-`),
  );
  workRepos.push(dir);
  run("git", ["init", "-b", "main", "."], dir);
  run(
    "git",
    ["remote", "add", "origin", "https://github.com/kolu-e2e/parser.git"],
    dir,
  );
  fs.writeFileSync(
    path.join(dir, "README.md"),
    "a repo for one piece of work\n",
  );
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-m", "init"], dir);
  run("git", ["checkout", "-b", "rewrite-the-parser"], dir);
  this.workRepoDir = dir;
});

/** OPEN THE WORK. The fixture's `open <title>` is a real `work_open` on the
 *  fleet face with the setup all given except what to do on green — so the
 *  card and its one open question appear at once, and the turn stays in flight
 *  until that question is answered (which is a step, here or on the card).
 *
 *  The id is read off the CARD rather than parsed out of the agent's prose:
 *  the card's `data-work` is the client's own reading of the record, so every
 *  later step is about the same work the person is looking at. */
When(
  "I ask the conductor to open the work {string}",
  async function (this: KoluWorld, title: string) {
    await enterConductor(this);
    this.workTitle = title;
    await sendPrompt(this, `open ${title}`);
    await showWorkColumn(this);
    let inventoryAtTimeout = "(not observed)";
    const id = await pollFor({
      observe: () =>
        this.page
          .locator(`${WORK_COLUMN} ${WORK_CARD}`)
          .evaluateAll((cards, want) => {
            for (const card of cards) {
              if ((card.textContent ?? "").includes(want)) {
                return card.getAttribute("data-work");
              }
            }
            return null;
          }, title),
      isDone: (found) => found !== null,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
      onTimeout: (_last, ms) =>
        new Error(
          `no card for ${JSON.stringify(title)} after ${ms}ms; the transcript holds ${inventoryAtTimeout}`,
        ),
    });
    if (id === null) throw new Error("the work card carries no id");
    this.workId = id;
  },
);

/** THE SAME QUESTION, from the two places the human may answer it. The card's
 *  copy is the SAME ask row the chat draws — one record, two faces — so these
 *  two steps differ only in which face they press. */
When(
  "I answer the work's question with {string} on the card",
  async function (this: KoluWorld, value: string) {
    // The question lives INSIDE the opened card — which is the gesture a
    // person makes: the card is violet because something is waiting on them,
    // and they open it to answer.
    await openWorkCard(this);
    const ask = workCard(this).locator('[data-testid="work-question"]');
    await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ask
      .locator(`[data-testid="conductor-ask-option"][data-value="${value}"]`)
      .click();
    await ask.locator('[data-testid="conductor-ask-submit"]').click();
  },
);

When(
  "I answer the work's question with {string} in the chat",
  async function (this: KoluWorld, value: string) {
    const ask = this.page.locator(`${TRANSCRIPT} ${ASK}`).last();
    await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ask
      .locator(`[data-testid="conductor-ask-option"][data-value="${value}"]`)
      .click();
    await ask.locator('[data-testid="conductor-ask-submit"]').click();
  },
);

Then("the work should have no open question", async function (this: KoluWorld) {
  await waitForCount(this, `${WORK_COLUMN} [data-testid="work-question"]`, 0);
});

/** THE WORK GETS AN IMPLEMENTOR — a real `lifecycle_create` on the fleet face
 *  carrying the work and the role, in the work's own repo, running the lazy
 *  omp stand-in: an agent that is UP with no transcript at all, which is the
 *  `ready` kolu records for a member coming up. The command is built here
 *  because only the test process knows the stand-in's absolute path (the
 *  harness seeds a renamed bash per worker). */
When(
  "I ask the conductor to run the implementor in the work's repo",
  async function (this: KoluWorld) {
    const bin = process.env.KOLU_FAKE_OMP_BIN;
    if (!bin) throw new Error("KOLU_FAKE_OMP_BIN must be set");
    const ompDir = process.env.KOLU_OMP_DIR;
    if (!ompDir) throw new Error("KOLU_OMP_DIR must be set");
    const repo = workRepo(this);
    const fixture = ompTranscriptPath({ ompDir, cwd: repo });
    memberFixture = fixture;
    const payload = ompMockPayload({
      breadcrumbDir: path.join(ompDir, "terminal-sessions"),
      transcriptPath: fixture.transcriptPath,
      // Never staged: this scenario moves the session itself, the way a
      // session kolu merely FINDS moves. The path only has to be somewhere the
      // repo is not, so the worktree stays the work's own files.
      stagePath: path.join(os.tmpdir(), `kolu-work-stage-${process.pid}`),
    });
    await enterConductor(this);
    await sendPrompt(
      this,
      `run the implementor in ${repo}: ${bin} -c '${payload}'`,
    );
    let inventoryAtTimeout = "(not observed)";
    const said = await pollFor({
      observe: async () => {
        const rows = await this.page
          .locator(`${TRANSCRIPT} ${ROW}[data-row-kind="agent"]`)
          .evaluateAll((all) => all.map((row) => row.textContent ?? ""));
        for (const text of rows) {
          const ref = /ran:[\s\S]*?\blocal\/([0-9a-f-]{36})\b/.exec(text);
          if (ref?.[1]) return ref[1];
        }
        return null;
      },
      isDone: (ref) => ref !== null,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
      onTimeout: (_last, ms) =>
        new Error(
          `the conductor never answered with the terminal it made for the work after ${ms}ms; the transcript holds ${inventoryAtTimeout}`,
        ),
    });
    if (said === null) throw new Error("no terminal ref was answered");
    this.memberTerminalId = said;
    // Every `… the member terminal` assertion below is about this one.
    this.watchedTerminalId = said;
  },
);

function memberSession(): { transcriptPath: string; sessionId: string } {
  assert.ok(memberFixture, "no member agent was started in this scenario");
  return memberFixture;
}

/** THE AGENT TAKES A PROMPT. The session file appears with the entries a real
 *  omp materializes for a session already thinking — the same bytes the
 *  stand-in would append had a person typed into it, written here because the
 *  keyboard belongs to the conversation by now (the `found session` case the
 *  Claude scenarios write the same way). */
When("the implementor's agent starts working", () => {
  stageOmpPrompt(memberSession().transcriptPath, "thinking");
});

/** ... and STOPS, by appending the entries that end a turn — the honest
 *  production channel: an append to the live transcript, no rewrite. */
When("the implementor's agent stops", () => {
  updateOmpFixture(memberSession(), "waiting");
});

/** A FILE IN THE WORKTREE. `.waterfall/` is where a waterfall's plan lands,
 *  and kolu lists that directory after a member's state changes — so this is
 *  the whole of the arrangement: the file exists, and the next change rings. */
When(
  "the implementor writes {string} into the work's repo",
  async function (this: KoluWorld, file: string) {
    const full = path.join(workRepo(this), file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(
      full,
      "# The plan\n\n1. Read the parser\n2. Rewrite it\n3. Open the PR\n",
    );
  },
);

/** STATE THE PULL REQUEST, and hurry the sensor honestly. padi re-resolves a
 *  PR on a 30-second poll OR the moment the terminal's git context changes;
 *  waiting out the poll would cost half a minute per step, so each statement
 *  moves the branch — a real git change the repo's own watcher reports, after
 *  which gh is asked again and answers what the scenario just wrote. */
function restatePullRequest(world: KoluWorld, pr: PrFixture): void {
  const repo = workRepo(world);
  statedPr = pr;
  statePullRequest(repo, pr);
  branchBumps += 1;
  run("git", ["checkout", "-b", `rewrite-the-parser-${branchBumps}`], repo);
}

function statedPullRequest(): PrFixture {
  assert.ok(statedPr, "this scenario has not opened a pull request yet");
  return statedPr;
}

When(
  "the work's pull request opens as #{int} {string}",
  async function (this: KoluWorld, number: number, title: string) {
    restatePullRequest(this, { number, title, state: "open", checks: [] });
  },
);

When(
  "the work's pull request starts its checks",
  async function (this: KoluWorld) {
    restatePullRequest(this, {
      ...statedPullRequest(),
      checks: [
        { name: "build", outcome: "pending" },
        { name: "tests", outcome: "pending" },
      ],
    });
  },
);

When("the work's pull request goes green", async function (this: KoluWorld) {
  restatePullRequest(this, {
    ...statedPullRequest(),
    checks: [
      { name: "build", outcome: "pass" },
      { name: "tests", outcome: "pass" },
    ],
  });
});

When("the work's pull request is merged", async function (this: KoluWorld) {
  restatePullRequest(this, { ...statedPullRequest(), state: "merged" });
});

/** THE TIMELINE AS DRAWN — every event's kind, who it is by, and its words.
 *  Quoted on a failure, because "no `merged` event" names a symptom while the
 *  list names the cause (nothing observed at all, or the wrong thing). */
async function timelineInventory(world: KoluWorld): Promise<string> {
  const events = await world.page
    .locator(`${WORK_COLUMN} [data-testid="work-event"]`)
    .evaluateAll((all) =>
      all.map(
        (event) =>
          `${event.getAttribute("data-kind")}/${event.getAttribute("data-by")} ${JSON.stringify(
            (event.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
          )}`,
      ),
    );
  return events.length === 0 ? "(no events)" : events.join(" | ");
}

/** Events of one kind whose text holds `contains` (empty matches them all). */
function timelineEvents(
  world: KoluWorld,
  kind: string,
  contains: string,
): Promise<number> {
  return world.page
    .locator(`${WORK_COLUMN} [data-testid="work-event"][data-kind="${kind}"]`)
    .evaluateAll(
      (all, want) =>
        all.filter((event) => (event.textContent ?? "").includes(want)).length,
      contains,
    );
}

/** KEEP THE CARD OPEN while something is waited for. A work that ENDS while
 *  a poll runs is re-drawn below the line, in the collapsed `Finished`
 *  section — so a card that was open a moment ago has no timeline on screen
 *  at all, and the wait would time out saying the event never arrived when
 *  what moved was the card. Cheap and silent: nothing here waits, it only
 *  presses what is already there. */
async function keepWorkCardOpen(world: KoluWorld): Promise<void> {
  const card = workCard(world);
  if (await card.isVisible().catch(() => false)) {
    if ((await card.getAttribute("data-open")) === null) {
      await card
        .locator('[data-testid="work-card-head"]')
        .click()
        .catch(() => {});
    }
    return;
  }
  const toggle = world.page.locator(
    `${WORK_COLUMN} [data-testid="work-finished-toggle"]`,
  );
  if (
    (await toggle.count()) > 0 &&
    (await toggle.getAttribute("aria-expanded")) !== "true"
  ) {
    await toggle.click().catch(() => {});
  }
}

async function waitForTimelineEvent(
  world: KoluWorld,
  kind: string,
  contains: string,
): Promise<void> {
  await openWorkCard(world);
  let inventoryAtTimeout = "(not observed)";
  await pollFor({
    observe: () => timelineEvents(world, kind, contains),
    isDone: (seen) => seen > 0,
    timeoutMs: POLL_TIMEOUT,
    onTick: async () => {
      await keepWorkCardOpen(world);
      inventoryAtTimeout = await timelineInventory(world);
    },
    onTimeout: (_last, ms) =>
      new Error(
        `no ${JSON.stringify(kind)} event${contains === "" ? "" : ` about ${JSON.stringify(contains)}`} after ${ms}ms; the timeline holds ${inventoryAtTimeout}`,
      ),
  });
}

Then(
  "the work's timeline should show a {string} event",
  async function (this: KoluWorld, kind: string) {
    await waitForTimelineEvent(this, kind, "");
  },
);

Then(
  "the work's timeline should show a {string} event saying {string}",
  async function (this: KoluWorld, kind: string, says: string) {
    await waitForTimelineEvent(this, kind, says);
  },
);

/** NOTHING BUT WHAT WAS OBSERVED. An instant, not a wait: the claim is that
 *  the event is not there NOW, before the thing it would report has happened. */
Then(
  "the work's timeline should show no {string} event",
  async function (this: KoluWorld, kind: string) {
    await openWorkCard(this);
    assert.equal(
      await timelineEvents(this, kind, ""),
      0,
      `the timeline already holds a ${JSON.stringify(kind)} event before anything could have observed one: ${await timelineInventory(this)}`,
    );
  },
);

Then(
  "the work card should name the pull request {string}",
  async function (this: KoluWorld, pr: string) {
    await openWorkCard(this);
    await pollFor({
      observe: async () =>
        (
          (await workCard(this)
            .locator('[data-testid="work-pr"]')
            .textContent({ timeout: 1_000 })
            .catch(() => null)) ?? "(no pull request on the card)"
        )
          .replace(/\s+/g, " ")
          .trim(),
      isDone: (seen) => seen.includes(pr),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the card never named ${JSON.stringify(pr)}; after ${ms}ms it said ${JSON.stringify(last)}`,
        ),
    });
  },
);

/** FINISHED work is below the line, collapsed: the card is reached by opening
 *  that section, and it carries the outcome kolu read off the PR. */
async function openFinished(world: KoluWorld): Promise<void> {
  await showWorkColumn(world);
  const section = world.page.locator(
    `${WORK_COLUMN} [data-testid="work-finished"]`,
  );
  await section.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const toggle = section.locator('[data-testid="work-finished-toggle"]');
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

Then(
  "the work should be finished as {string}",
  async function (this: KoluWorld, outcome: string) {
    const id = this.workId;
    assert.ok(id, "this scenario never opened a work");
    await openFinished(this);
    await waitForValue(
      "the finished work's outcome",
      async () => {
        const card = this.page.locator(
          `${WORK_COLUMN} [data-testid="work-finished"] ${WORK_CARD}[data-work="${id}"]`,
        );
        if ((await card.count()) === 0) return "not among the finished";
        return (await card.getAttribute("data-outcome")) ?? "no outcome";
      },
      outcome,
    );
  },
);

/** THE DECISIONS, with where each answer came from — the card or the chat —
 *  which is the half of the record the brief's addendum is about. */
Then(
  "the work's decisions should include {string} answered from the {word}",
  async function (this: KoluWorld, text: string, from: string) {
    await openWorkCard(this);
    await pollFor({
      observe: () =>
        this.page
          .locator(
            `${WORK_COLUMN} [data-testid="work-decision"][data-from="${from}"]`,
          )
          .evaluateAll((all) =>
            all.map((one) =>
              (one.textContent ?? "").replace(/\s+/g, " ").trim(),
            ),
          ),
      isDone: (read) => read.some((one) => one.includes(text)),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (read, ms) =>
        new Error(
          `no decision answered from the ${from} reads ${JSON.stringify(text)} after ${ms}ms; the card holds ${JSON.stringify(read)}`,
        ),
    });
  },
);

/** A FILE OPENS IN PLACE. The list is the live `.waterfall/` of the member's
 *  worktree (or, for finished work, what kolu kept) and pressing one opens it
 *  INSIDE the card. */
When(
  "I open the work's file {string}",
  async function (this: KoluWorld, file: string) {
    await openWorkCard(this);
    const row = this.page.locator(
      `${WORK_COLUMN} [data-testid="work-file"][data-path="${file}"]`,
    );
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await row.click();
  },
);

Then(
  "the work card should list the file {string}",
  async function (this: KoluWorld, file: string) {
    await openWorkCard(this);
    await this.page
      .locator(`${WORK_COLUMN} [data-testid="work-file"][data-path="${file}"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the work card should keep the file {string}",
  async function (this: KoluWorld, file: string) {
    // KEPT, not merely listed: a finished work's worktree may be gone, so the
    // row that is still there is a copy kolu took when the work ended.
    await openWorkCard(this);
    await this.page
      .locator(
        `${WORK_COLUMN} [data-testid="work-file"][data-path="${file}"][data-kept]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** RENDERED, in the card. The heading has to be a real heading — markdown
 *  shown as its own source passes a text match and is not what was promised. */
Then(
  "the work card should render {string} as a heading",
  async function (this: KoluWorld, heading: string) {
    const view = this.page.locator(
      `${WORK_COLUMN} [data-testid="work-file-view"]`,
    );
    await view.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForValue(
      "the headings the opened file renders",
      async () =>
        (
          await view.evaluateAll((views) =>
            views.flatMap((one) =>
              [...one.querySelectorAll("h1, h2, h3")].map((h) =>
                (h.textContent ?? "").trim(),
              ),
            ),
          )
        )
          .filter((text) => text === heading)
          .join(","),
      heading,
    );
  },
);

/** THE MARK EVERYWHERE ELSE. A terminal that belongs to a work carries the
 *  Conductor's mark, its role and the work's title — one derivation, so the
 *  dock row is the cheapest place to prove it reaches outside the pane. */
Then(
  "the dock row for the member terminal should carry the work's mark as the {string}",
  async function (this: KoluWorld, role: string) {
    const id = this.memberTerminalId;
    assert.ok(id, "this scenario never put a terminal into a work");
    const title = this.workTitle;
    assert.ok(title, "this scenario never named its work");
    const mark = this.page.locator(
      `[data-testid="dock-row"][data-terminal-id="${id}"] [data-testid="work-mark"]`,
    );
    await mark.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForValue(
      "the dock row's mark",
      async () => (await mark.getAttribute("data-role")) ?? "absent",
      role,
    );
    const reads = ((await mark.textContent()) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    assert.ok(
      reads.includes(title),
      `the dock row's mark reads ${JSON.stringify(reads)}, which does not name the work ${JSON.stringify(title)}`,
    );
  },
);

/** THE SERVER GOES AWAY AND COMES BACK. Not a reload — the process itself is
 *  replaced, on a fresh port, with the same state directory — so what is on
 *  screen afterwards is what was WRITTEN, not what a tab happened to hold. */
When(
  "the kolu server is restarted",
  { timeout: 180_000 },
  async function (this: KoluWorld) {
    const url = await restartKoluServer();
    await this.page.goto(url);
    await this.page
      .locator(
        '[data-visible] .xterm-screen, [data-testid="dormant-tile-body"], [data-testid="empty-state"]',
      )
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
