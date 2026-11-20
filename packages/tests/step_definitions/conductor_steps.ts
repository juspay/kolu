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
import {
  FIXTURE_LIST_FAILS,
  fixtureClaudeRelay,
} from "../support/agentDistroFixture.ts";
import { type PrFixture, statePullRequest } from "../support/fake-gh.ts";
import {
  expectNoDiagramError,
  waitForPaintedDiagram,
} from "../support/diagram.ts";
import { restartKoluServer } from "../support/hooks.ts";
import { pollFor } from "../support/poll.ts";
import { surfaceCall, surfaceFirstFrame } from "../support/rpcWire.ts";
import { type KoluWorld, MOD_KEY, POLL_TIMEOUT } from "../support/world.ts";
import { turnAgentsOnReady } from "./agents_steps.ts";

const REPEAT_WAKE_WINDOW_MS = 4_000;

let conductorAgentCwd: string | null = null;

After(() => {
  if (conductorAgentCwd && fs.existsSync(conductorAgentCwd)) {
    fs.rmSync(conductorAgentCwd, { recursive: true, force: true });
  }
  conductorAgentCwd = null;
  fs.rmSync(fixtureClaudeRelay(), { force: true });
});

const PANE = '[data-testid="conductor-pane"]';
const TAB = '[data-testid="conductor-tab"]';
const MOBILE_HANDLE = '[data-testid="mobile-pull-handle"]';
const MOBILE_SHEET = '[data-testid="mobile-chrome-sheet"]';
const BADGE = `${TAB} [data-testid="conductor-badge"]`;
const PHASE = '[data-testid="conductor-phase"]';
const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const ROW = '[data-testid="conductor-row"]';
const TOOL_CARD = '[data-testid="conductor-tool-card"]';
const INPUT = '[data-testid="conductor-input"]';
const SEND = '[data-testid="conductor-send"]';
const ASK = '[data-testid="conductor-ask"]';
const MENU = '[data-testid="conductor-menu"]';
const MENU_PANEL = '[data-testid="conductor-menu-panel"]';
const MENU_NEW_SESSION = '[data-testid="conductor-menu-new-session"]';
const MENU_NEW_SESSION_CONFIRM =
  '[data-testid="conductor-menu-new-session-confirm"]';
const USER_MARK = '[data-testid="conductor-user-mark"]';
const CHIP_ATTACHMENT = '[data-testid="conductor-attachment-chip"]';
const ROW_ATTACHMENT = '[data-testid="conductor-row-attachment"]';
const CHROME_BAR = '[data-testid="chrome-bar"]';
const HOST_TAB = '[data-testid="host-chip-row"] [data-testid="host-chip"]';
const CANVAS_TILE = '[data-testid="canvas-tile"]';

const CONDUCTOR_CHORD = "Meta+Shift+O";

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

export async function enterConductor(world: KoluWorld): Promise<void> {
  const pane = world.page.locator(PANE);
  if (await pane.isVisible()) return;
  const handle = world.page.locator(MOBILE_HANDLE);
  if (await handle.isVisible()) await handle.click();
  const tab = world.page.locator(TAB);
  await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  if ((await tab.getAttribute("data-active")) === null) await tab.click();
  await pane.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

export async function sendPrompt(
  world: KoluWorld,
  text: string,
): Promise<void> {
  const input = world.page.locator(INPUT);
  await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await input.click();
  await input.fill(text);
  await world.page.locator(SEND).click();
}

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

async function pressNewSession(world: KoluWorld): Promise<void> {
  await enterConductor(world);
  await world.page.locator(MENU).click();
  await waitForAtLeastOne(world, MENU_PANEL);
  await world.page.locator(MENU_NEW_SESSION).click();
  await world.page.locator(MENU_NEW_SESSION_CONFIRM).click();
}

const WIPE_SETTLE_MS = 5_000;

async function newConductorSession(world: KoluWorld): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await pressNewSession(world);
    const quiet = await pollFor({
      observe: async () =>
        (await world.page.locator(`${TRANSCRIPT} ${ROW}`).count()) === 0 &&
        (await world.page.locator(PANE).getAttribute("data-phase")) === "idle",
      isDone: (still) => still,
      timeoutMs: WIPE_SETTLE_MS,
      onTimeout: () => new Error("the conversation is not quiet yet"),
    }).catch(() => false);
    if (quiet) break;
  }
  await waitForCount(world, `${TRANSCRIPT} ${ROW}`, 0);
  await waitForValue(
    "conductor phase after a new session",
    async () =>
      (await world.page.locator(PANE).getAttribute("data-phase")) ?? "absent",
    "idle",
  );
}
When(
  "I leave the conductor for the host tab",
  async function (this: KoluWorld) {
    const pane = this.page.locator(PANE);
    if (!(await pane.isVisible())) return;
    await this.page.keyboard.press(CONDUCTOR_CHORD);
    await pane.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

async function stopWorksLeftOpenByEarlierScenarios(): Promise<void> {
  await pollFor({
    observe: async () => {
      const ids = (await surfaceFirstFrame(
        "surface/kolu/works/keys",
      )) as readonly string[];
      let open = 0;
      for (const id of ids) {
        const work = (await surfaceFirstFrame("surface/kolu/works/get", {
          key: id,
        })) as { state: { kind: string } };
        if (work.state.kind !== "open") continue;
        open += 1;
        await surfaceCall("surface/kolu/conductor/stopWork", { work: id });
      }
      return open;
    },
    isDone: (open) => open === 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (open, ms) =>
      new Error(
        `${open ?? "?"} piece(s) of work were still open after ${ms}ms of stopping them — this scenario would have counted another one's work`,
      ),
  });
}

const NEWS_SETTLE_MS = 1_500;
const NEWS_DRAIN_MS = 10_000;

Given(
  "the conductor is on a fresh conversation",
  async function (this: KoluWorld) {
    await turnAgentsOnReady(this);
    await stopWorksLeftOpenByEarlierScenarios();
    await enterConductor(this);
    const rows = async (): Promise<number> =>
      this.page.locator(`${TRANSCRIPT} ${ROW}`).count();
    let last = await rows();
    const deadline = Date.now() + NEWS_DRAIN_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, NEWS_SETTLE_MS));
      const now = await rows();
      if (now === last) break;
      last = now;
    }
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
    const pane = await this.page.locator(PANE).boundingBox();
    const bar = await this.page.locator(CHROME_BAR).boundingBox();
    const viewport = this.page.viewportSize();
    assert.ok(pane, "the conductor pane has no box");
    assert.ok(bar, "the chrome bar has no box");
    assert.ok(viewport, "the page has no viewport size");
    const laidOut = await this.page.locator(PANE).evaluate((el) => {
      const style = getComputedStyle(el);
      const parent = el.parentElement;
      return `position: ${style.position}, parent ${parent?.className ?? "(none)"} is ${parent === null ? "?" : Math.round(parent.getBoundingClientRect().width)}px wide`;
    });
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

async function currentHostTabs(world: KoluWorld): Promise<number> {
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
    await waitForCount(this, BADGE, 0);
  },
);

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
    await waitForAtLeastOne(
      this,
      `${TRANSCRIPT} ${ROW}[data-row-kind="${kind}"]:has-text(${JSON.stringify(text)})`,
    );
  },
);

const agentRowSaying = (world: KoluWorld, text: string) =>
  world.page
    .locator(`${TRANSCRIPT} ${ROW}[data-row-kind="agent"]`)
    .filter({ hasText: text })
    .last();

Then(
  "the conductor agent row saying {string} should show a painted diagram",
  async function (this: KoluWorld, text: string) {
    await waitForPaintedDiagram(
      agentRowSaying(this, text),
      `the agent row saying "${text}"`,
    );
  },
);

Then(
  "the conductor agent row saying {string} should show no diagram error",
  async function (this: KoluWorld, text: string) {
    await expectNoDiagramError(
      agentRowSaying(this, text),
      `the agent row saying "${text}"`,
    );
  },
);

Then(
  "the conductor agent row saying {string} should still fold its long list",
  async function (this: KoluWorld, text: string) {
    const row = agentRowSaying(this, text);
    const fold = await row.evaluate((el) => ({
      control: el
        .querySelector('[data-testid="conductor-prose-more"]')
        ?.getAttribute("aria-expanded"),
      hidden: el.querySelectorAll("li[hidden]").length,
    }));
    assert.deepStrictEqual(
      fold,
      { control: "false", hidden: 3 },
      `the six-item list is not folded: ${JSON.stringify(fold)}`,
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
    const said: string[] = [];
    this.conductorConsole = said;
    this.page.on("console", (message) => {
      said.push(`${message.type()}: ${message.text()}`);
    });

    const input = this.page.locator(INPUT);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.click();
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
    await waitForAtLeastOne(this, `${CHIP_ATTACHMENT}:not([data-uploading])`);
  },
);

Then(
  "the conductor transcript should show a user row carrying an image attachment",
  async function (this: KoluWorld) {
    const want = `${TRANSCRIPT} ${ROW}[data-row-kind="user"] ${ROW_ATTACHMENT}[data-mime="image/png"]`;
    let rows = "(not observed)";
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

const TOOL_DETAIL = '[data-testid="conductor-tool-detail"]';

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
    assert.ok(
      box.scroll <= box.client + 1,
      `the card's content is ${box.scroll}px wide inside a ${box.client}px card — the payload escaped it\n${chain}`,
    );
    assert.ok(
      box.column > 0 && box.offset <= box.column + 1,
      `the card is ${box.offset}px wide in a ${box.column}px transcript — the payload widened the card itself\n${chain}`,
    );
  },
);

Then(
  "that tool card's payload should be readable without scrolling sideways",
  async function (this: KoluWorld) {
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

Then("the chrome bar should fit the window", async function (this: KoluWorld) {
  const bar = await this.page.locator(CHROME_BAR).evaluate((el) => {
    const style = getComputedStyle(el);
    const kids = [...el.children].map((child) => child as HTMLElement);
    return {
      client: el.clientWidth,
      scroll: el.scrollWidth,
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

const TO_BOTTOM = `${PANE} [data-testid="scroll-to-bottom"]`;

const FOLLOW_SLACK_PX = 48;

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
  await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await this.page.mouse.wheel(0, -600);
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

const LOOK = `${TOOL_CARD}[data-tool-kind="create"] [data-testid="conductor-look"]`;

Then(
  "that tool card should say how its terminal is doing",
  async function (this: KoluWorld) {
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
    await waitForCount(
      this,
      `${LOOK} [data-testid="conductor-look-toggle"]`,
      0,
    );
    await waitForCount(this, `${LOOK} [data-testid="conductor-look-tail"]`, 0);
  },
);

const FOLD = `${TRANSCRIPT} [data-testid="conductor-fold"]`;

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

const IN_FLOW_STATUS: Record<string, string> = {
  failed: "failed",
  running: "in_progress",
};

Then(
  "the {word} tool call should stay in the flow",
  async function (this: KoluWorld, which: string) {
    const status = IN_FLOW_STATUS[which];
    assert.ok(status !== undefined, `no tool-call status is named "${which}"`);
    await waitForValue(
      `${which} tool cards outside the fold`,
      async () =>
        String(
          await visibleCount(
            this,
            `${TRANSCRIPT} ${ROW} ${TOOL_CARD}[data-status="${status}"]:not(${FOLD} *)`,
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

Then(
  "the mobile chrome sheet should put the conductor first, lit, and no host lit",
  async function (this: KoluWorld) {
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

const STATUS = '[data-testid="conductor-status"]';
const WORK_COUNT = '[data-testid="conductor-work-count"]';
const HELD = '[data-testid="conductor-held"]';
const WORK_COLUMN = '[data-testid="work-column"]';
const WORK_CARD = '[data-testid="work-card"]';
const WORK_MEMBER = '[data-testid="work-member"]';
const WAKE_ROW = `${ROW}[data-row-kind="wake"]`;
const STEER_HINT = '[data-testid="conductor-steer-hint"]';

async function countIn(world: KoluWorld, selector: string): Promise<string> {
  const node = world.page.locator(selector);
  if ((await node.count()) === 0) return "absent";
  const text = (await node.first().textContent()) ?? "";
  return text.match(/\d+/)?.[0] ?? `no number in ${JSON.stringify(text)}`;
}

function watchedId(world: KoluWorld): string {
  const id = world.watchedTerminalId;
  assert.ok(id, "no terminal was joined to a work in this scenario");
  return id;
}

function memberRow(world: KoluWorld) {
  return world.page.locator(
    `${WORK_COLUMN} ${WORK_MEMBER}[data-ref$="/${watchedId(world)}"]`,
  );
}

function noteWatchWork(world: KoluWorld, id: string): void {
  world.watchedTerminalId = id;
  world.workTitle = `watch ${id}`;
}

When(
  "I ask the conductor to watch the terminal",
  async function (this: KoluWorld) {
    const id = await this.page
      .locator(`${CANVAS_TILE}[data-active]`)
      .getAttribute("data-terminal-id", { timeout: POLL_TIMEOUT });
    assert.ok(id, "no tile is focused, so there is nothing to watch");
    noteWatchWork(this, id);
    await enterConductor(this);
    await sendPrompt(this, `watch ${id}`);
  },
);

When(
  "I ask the conductor to watch the first terminal",
  async function (this: KoluWorld) {
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
    const id = this.createdTerminalIds.at(-1);
    assert.ok(id, "no terminal was created in this scenario");
    noteWatchWork(this, id);
    await enterConductor(this);
    await sendPrompt(this, `watch ${id}`);
  },
);

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

function wakeChip(world: KoluWorld) {
  const title = world.workTitle;
  assert.ok(title, "this scenario never named the work it opened");
  return world.page
    .locator(
      `${WAKE_ROW} [data-testid="conductor-wake-works"] [data-testid="work-chip"]`,
    )
    .filter({ hasText: title })
    .last();
}

Then(
  "the wake should name the watched work with a chip",
  async function (this: KoluWorld) {
    await wakeChip(this).waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I press the wake's work chip", async function (this: KoluWorld) {
  await wakeChip(this).click();
});

When(
  "I press the work's chip in the conversation",
  async function (this: KoluWorld) {
    const title = this.workTitle;
    assert.ok(title, "this scenario never named the work it opened");
    const chip = this.page
      .locator(
        '[data-testid="conductor-chat"] [data-testid="conductor-turn-works"] [data-testid="work-chip"]',
      )
      .filter({ hasText: title })
      .last();
    await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await chip.click();
  },
);

Then(
  "the watched work's card should be open",
  async function (this: KoluWorld) {
    const card = workCard(this);
    await card.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await pollFor({
      observe: () =>
        card.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return {
            open: el.hasAttribute("data-open"),
            onScreen: box.bottom > 0 && box.top < window.innerHeight,
          };
        }),
      isDone: (seen) => seen.open && seen.onScreen,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `${ms}ms after the chip the work's card was ${last?.open ? "open" : "shut"} and ${last?.onScreen ? "on" : "off"} screen`,
        ),
    });
  },
);

Then(
  "the conductor transcript should show a {string} wake about the watched terminal",
  async function (this: KoluWorld, level: string) {
    const id = watchedId(this);
    let inventoryAtTimeout = "(not observed)";
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
  assert.equal(await wake.locator(USER_MARK).count(), 0);
});

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
    stageOmpPrompt(stagePath, "thinking");
    const program = path.join(conductorAgentCwd, "omp-stand-in.sh");
    fs.writeFileSync(
      program,
      ompMockPayload({
        breadcrumbDir: path.join(ompDir, "terminal-sessions"),
        transcriptPath: fixture.transcriptPath,
        stagePath,
      }),
    );
    fs.writeFileSync(fixtureClaudeRelay(), `${bin} ${program}`);
    await enterConductor(this);
    await sendPrompt(this, `run an agent in ${conductorAgentCwd}`);
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
    .locator('[data-testid="conductor-wake-headline"]')
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

export async function showWorkColumn(world: KoluWorld): Promise<void> {
  if ((await world.page.locator(WORK_COLUMN).count()) === 0) {
    await world.page.locator(`${STATUS} ${WORK_COUNT}`).click();
  }
  await world.page
    .locator(WORK_COLUMN)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

export function workCard(world: KoluWorld) {
  const id = world.workId;
  if (id !== undefined)
    return world.page.locator(`${WORK_COLUMN} ${WORK_CARD}[data-work="${id}"]`);
  const cards = world.page.locator(`${WORK_COLUMN} ${WORK_CARD}`);
  const title = world.workTitle;
  return title === undefined
    ? cards.first()
    : cards.filter({ hasText: title }).first();
}

export async function openWorkCard(world: KoluWorld): Promise<void> {
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
  await showWorkColumn(this);
  await workCard(this).waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the work column should list the terminal as a member",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    const id = watchedId(this);
    let held = "(not observed)";
    await pollFor({
      observe: () => memberRow(this).count(),
      isDone: (rows) => rows > 0,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        const refs = await this.page
          .locator(`${WORK_COLUMN} ${WORK_MEMBER}`)
          .evaluateAll((all) =>
            all.map((row) => row.getAttribute("data-ref") ?? "?"),
          );
        const terminals = await this.terminalIds();
        held = `${refs.length === 0 ? "no members" : refs.join(", ")}; terminals on screen ${terminals.length === 0 ? "none" : terminals.join(", ")}; timeline ${await timelineInventory(this)}`;
      },
      onTimeout: (_last, ms) =>
        new Error(
          `the card never listed ${id} as a member after ${ms}ms; it holds ${held}`,
        ),
    });
    await memberRow(this).waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I look at the member terminal", async function (this: KoluWorld) {
  await memberRow(this).locator('[data-testid="work-member-look"]').click();
});

When("I press the member terminal's name", async function (this: KoluWorld) {
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
    const phases = this.page.locator(PHASE);
    assert.equal(await phases.count(), 1);
    assert.equal(await this.page.locator(`${STATUS} ${PHASE}`).count(), 1);
  },
);

When("I mark the conductor pane", async function (this: KoluWorld) {
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

const HELP = '[data-testid="conductor-help"]';
const HELP_TOGGLE = '[data-testid="conductor-help-toggle"]';
const HELP_CONTENT = '[data-testid="conductor-help-content"]';
const HELP_SECTION = '[data-testid="conductor-help-section"]';
const HELP_SHEET = '[data-testid="conductor-help-sheet"]';
const MENU_HELP = '[data-testid="conductor-menu-help"]';

const HELP_SECTIONS = [
  "ask",
  "waterfall",
  "while-it-works",
  "the-card",
  "terminals",
  "the-lock",
  "files",
  "mid-work",
  "wakes",
  "asks",
];

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

const workRepos: string[] = [];
let memberFixture: { transcriptPath: string; sessionId: string } | null = null;
let branchBumps = 0;
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

function openWords(world: KoluWorld, title: string): string {
  const dir = world.workRepoDir;
  return dir === undefined ? `open ${title}` : `open ${title} in ${dir}`;
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: "ignore" });
}

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

When(
  "I ask the conductor to open the work {string}",
  async function (this: KoluWorld, title: string) {
    await openWorkSaying(this, title, openWords(this, title));
  },
);

When(
  "I ask the conductor to open the trivial work {string}",
  async function (this: KoluWorld, title: string) {
    await openWorkSaying(
      this,
      title,
      `open trivially ${title} in ${workRepo(this)}`,
    );
  },
);

When(
  "I ask the conductor to open the work {string} with its model left to me",
  async function (this: KoluWorld, title: string) {
    const dir = this.workRepoDir;
    await openWorkSaying(
      this,
      title,
      `open the model by hand ${title}${dir === undefined ? "" : ` in ${dir}`}`,
    );
  },
);

async function openWorkSaying(
  world: KoluWorld,
  title: string,
  prompt: string,
): Promise<void> {
  await enterConductor(world);
  world.workTitle = title;
  await sendPrompt(world, prompt);
  await showWorkColumn(world);
  let inventoryAtTimeout = "(not observed)";
  const id = await pollFor({
    observe: () =>
      world.page
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
      inventoryAtTimeout = await transcriptInventory(world);
    },
    onTimeout: (_last, ms) =>
      new Error(
        `no card for ${JSON.stringify(title)} after ${ms}ms; the transcript holds ${inventoryAtTimeout}`,
      ),
  });
  if (id === null) throw new Error("the work card carries no id");
  world.workId = id;
}

async function modelQuestion(world: KoluWorld) {
  await openWorkCard(world);
  const ask = workCard(world).locator('[data-testid="work-question"]');
  await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  return ask;
}

Then(
  "the work's model question should say the host could not list its models",
  async function (this: KoluWorld) {
    const ask = await modelQuestion(this);
    const said = ask.locator('[data-testid="conductor-ask-failed"]');
    await said.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.ok(
      (await said.innerText()).includes(FIXTURE_LIST_FAILS),
      `the question says ${JSON.stringify(await said.innerText())}, not the host's words`,
    );
  },
);

Then(
  "the work's model question should offer {string} from before, and a box",
  async function (this: KoluWorld, model: string) {
    const ask = await modelQuestion(this);
    const chip = ask.locator(
      `[data-testid="conductor-ask-option"][data-value="${model}"]`,
    );
    await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.notEqual(
      await chip.getAttribute("data-active"),
      null,
      `${model}, the model run before, is not already the answer`,
    );
    await ask
      .locator('[data-testid="conductor-ask-other"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I answer the work's model question by typing {string} on the card",
  async function (this: KoluWorld, model: string) {
    const ask = await modelQuestion(this);
    await ask.locator('[data-testid="conductor-ask-other"]').fill(model);
    await ask.locator('[data-testid="conductor-ask-submit"]').click();
  },
);

Then(
  "the work's model question should show only {string}, and {int} more",
  async function (this: KoluWorld, models: string, more: number) {
    const want = models.split(",").map((one) => one.trim());
    const ask = await modelQuestion(this);
    let last = { drawn: [] as string[], active: [] as string[], more: "" };
    await pollFor({
      observe: async () => {
        last = {
          drawn: await ask
            .locator('[data-testid="conductor-ask-option"]')
            .evaluateAll((all) =>
              all.map((one) => one.getAttribute("data-value") ?? ""),
            ),
          active: await ask
            .locator('[data-testid="conductor-ask-option"][data-active]')
            .evaluateAll((all) =>
              all.map((one) => one.getAttribute("data-value") ?? ""),
            ),
          more:
            (await ask
              .locator('[data-testid="conductor-ask-more"]')
              .getAttribute("data-hidden", { timeout: 1_000 })
              .catch(() => null)) ?? "",
        };
        return last;
      },
      isDone: (now) =>
        JSON.stringify(now.drawn) === JSON.stringify(want) &&
        now.active.length === 1 &&
        want.includes(now.active[0] ?? "") &&
        now.more === String(more),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, ms) =>
        new Error(
          `the model question never drew only ${JSON.stringify(want)} with ${more} more after ${ms}ms; it drew ${JSON.stringify(last)}`,
        ),
    });
  },
);

When(
  "I search the work's model question for {string}",
  async function (this: KoluWorld, text: string) {
    const ask = await modelQuestion(this);
    await ask.locator('[data-testid="conductor-ask-search"]').fill(text);
  },
);

Then(
  "the work's model question should find {string}",
  async function (this: KoluWorld, model: string) {
    const ask = await modelQuestion(this);
    await ask
      .locator(`[data-testid="conductor-ask-option"][data-value="${model}"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I pick {string} from the search of the work's model question",
  async function (this: KoluWorld, model: string) {
    const ask = await modelQuestion(this);
    await ask
      .locator(`[data-testid="conductor-ask-option"][data-value="${model}"]`)
      .click({ timeout: POLL_TIMEOUT });
    await ask.locator('[data-testid="conductor-ask-search"]').fill("");
  },
);

When("I send the work's model question", async function (this: KoluWorld) {
  const ask = await modelQuestion(this);
  await ask.locator('[data-testid="conductor-ask-submit"]').click();
});

Then(
  "the conductor should say it ran {string}",
  async function (this: KoluWorld, command: string) {
    let inventoryAtTimeout = "(not observed)";
    await pollFor({
      observe: () =>
        this.page
          .locator(`${TRANSCRIPT} ${ROW}[data-row-kind="agent"]`)
          .evaluateAll((rows) => rows.map((row) => row.textContent ?? "")),
      isDone: (rows) =>
        rows.some((text) => text.includes("ran:") && text.includes(command)),
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        inventoryAtTimeout = await transcriptInventory(this);
      },
      onTimeout: (_last, ms) =>
        new Error(
          `the conductor never said it ran ${JSON.stringify(command)} after ${ms}ms; the transcript holds ${inventoryAtTimeout}`,
        ),
    });
  },
);

When(
  "I answer the work's question with {string} on the card",
  async function (this: KoluWorld, value: string) {
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
    const ask = this.page
      .locator(`${TRANSCRIPT} [data-testid="work-question"][data-from="chat"]`)
      .last();
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
    const program = path.join(
      path.dirname(fixtureClaudeRelay()),
      "omp-stand-in.sh",
    );
    fs.writeFileSync(
      program,
      ompMockPayload({
        breadcrumbDir: path.join(ompDir, "terminal-sessions"),
        transcriptPath: fixture.transcriptPath,
        stagePath: path.join(os.tmpdir(), `kolu-work-stage-${process.pid}`),
      }),
    );
    fs.writeFileSync(fixtureClaudeRelay(), `${bin} ${program}`);
    await enterConductor(this);
    await sendPrompt(this, `run the implementor in ${repo}`);
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
    this.watchedTerminalId = said;
  },
);

function memberSession(): { transcriptPath: string; sessionId: string } {
  assert.ok(memberFixture, "no member agent was started in this scenario");
  return memberFixture;
}

When("the implementor's agent starts working", () => {
  stageOmpPrompt(memberSession().transcriptPath, "thinking");
});

When("the implementor's agent stops", () => {
  updateOmpFixture(memberSession(), "waiting");
});

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
  "the work's pull request opens as draft #{int} {string}",
  async function (this: KoluWorld, number: number, title: string) {
    restatePullRequest(this, {
      number,
      title,
      state: "open",
      checks: [],
      draft: true,
    });
  },
);

When(
  "the work's pull request passes its checks",
  async function (this: KoluWorld) {
    restatePullRequest(this, {
      ...statedPullRequest(),
      checks: [
        { name: "build", outcome: "pass" },
        { name: "tests", outcome: "pass" },
      ],
      mergeState: "CLEAN",
    });
  },
);

When(
  "the work's pull request is marked ready for review",
  async function (this: KoluWorld) {
    restatePullRequest(this, { ...statedPullRequest(), draft: false });
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

When(
  "the work's pull request goes green but GitHub still wants a review",
  async function (this: KoluWorld) {
    restatePullRequest(this, {
      ...statedPullRequest(),
      checks: [
        { name: "build", outcome: "pass" },
        { name: "tests", outcome: "pass" },
      ],
      mergeState: "BLOCKED",
      review: "REVIEW_REQUIRED",
    });
  },
);

When(
  "GitHub lets the work's pull request merge",
  async function (this: KoluWorld) {
    restatePullRequest(this, {
      ...statedPullRequest(),
      mergeState: "CLEAN",
      review: "APPROVED",
    });
  },
);

When(
  "the work's pull request is pushed to a new commit",
  async function (this: KoluWorld) {
    restatePullRequest(this, {
      ...statedPullRequest(),
      head: "9b7e3d1aa5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5",
      checks: [
        { name: "build", outcome: "pending" },
        { name: "tests", outcome: "pending" },
      ],
    });
  },
);

When("the work's pull request is merged", async function (this: KoluWorld) {
  restatePullRequest(this, { ...statedPullRequest(), state: "merged" });
});

Then(
  "the work card should say its pull request is a draft",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    const pr = statedPullRequest();
    const card = workCard(this);
    const read = async () => ({
      subtitle: (
        (await card
          .locator('[data-testid="work-subtitle"]')
          .textContent({ timeout: 1_000 })
          .catch(() => null)) ?? ""
      )
        .replace(/\s+/g, " ")
        .trim(),
      state: await card
        .locator('[data-testid="work-pr-state"]')
        .evaluate(
          (el) => ({
            draft: el.getAttribute("data-draft"),
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          }),
          undefined,
          { timeout: 1_000 },
        )
        .catch(() => null),
    });
    await pollFor({
      observe: read,
      isDone: (seen) =>
        seen.subtitle.includes(`draft PR #${pr.number}`) &&
        seen.state?.draft === "true" &&
        seen.state.text.includes("draft"),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `after ${ms}ms the card did not say #${pr.number} is a draft: ${JSON.stringify(last)}`,
        ),
    });
  },
);

export async function waitForNeedsYouBellVerdict(
  world: KoluWorld,
): Promise<void> {
  for (let frame = 0; frame < 6; frame += 1) await world.waitForFrame();
}

Then(
  "the Conductor's bell should have had its frames to decide",
  async function (this: KoluWorld) {
    await waitForNeedsYouBellVerdict(this);
  },
);

async function timelineInventory(world: KoluWorld): Promise<string> {
  const events = await workCard(world)
    .locator('[data-testid="work-event"]')
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

function timelineEvents(
  world: KoluWorld,
  kind: string,
  contains: string,
): Promise<number> {
  return workCard(world)
    .locator(`[data-testid="work-event"][data-kind="${kind}"]`)
    .evaluateAll(
      (all, want) =>
        all.filter((event) => (event.textContent ?? "").includes(want)).length,
      contains,
    );
}

export async function reopenWorkCardAndUnfoldTimeline(
  world: KoluWorld,
): Promise<void> {
  const card = workCard(world);
  if (await card.isVisible().catch(() => false)) {
    if ((await card.getAttribute("data-open")) === null) {
      await card
        .locator('[data-testid="work-card-head"]')
        .click()
        .catch(() => {});
    }
    const whole = card.locator('[data-testid="work-timeline-whole"]');
    if (
      (await whole.count()) > 0 &&
      (await whole.getAttribute("aria-expanded").catch(() => null)) === "false"
    )
      await whole.click().catch(() => {});
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
  await reopenWorkCardAndUnfoldTimeline(world);
  let inventoryAtTimeout = "(not observed)";
  await pollFor({
    observe: () => timelineEvents(world, kind, contains),
    isDone: (seen) => seen > 0,
    timeoutMs: POLL_TIMEOUT,
    onTick: async () => {
      await reopenWorkCardAndUnfoldTimeline(world);
      inventoryAtTimeout = await timelineInventory(world);
    },
    onTimeout: (_last, ms) =>
      new Error(
        `no ${JSON.stringify(kind)} event${contains === "" ? "" : ` about ${JSON.stringify(contains)}`} after ${ms}ms; the timeline holds ${inventoryAtTimeout}`,
      ),
  });
}

Then(
  "the work's timeline should show a/an {string} event",
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

Then(
  "the work's timeline should show no {string} event",
  async function (this: KoluWorld, kind: string) {
    await openWorkCard(this);
    await reopenWorkCardAndUnfoldTimeline(this);
    assert.equal(
      await timelineEvents(this, kind, ""),
      0,
      `the timeline already holds a ${JSON.stringify(kind)} event before anything could have observed one: ${await timelineInventory(this)}`,
    );
  },
);

Then(
  "the work's timeline should show {int} {string} events",
  async function (this: KoluWorld, many: number, kind: string) {
    await openWorkCard(this);
    await reopenWorkCardAndUnfoldTimeline(this);
    let inventoryAtTimeout = "(not observed)";
    await pollFor({
      observe: () => timelineEvents(this, kind, ""),
      isDone: (seen) => seen >= many,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        await reopenWorkCardAndUnfoldTimeline(this);
        inventoryAtTimeout = await timelineInventory(this);
      },
      onTimeout: (last, ms) =>
        new Error(
          `${last} ${JSON.stringify(kind)} events after ${ms}ms, wanted ${many}; the timeline holds ${inventoryAtTimeout}`,
        ),
    });
    assert.equal(
      await timelineEvents(this, kind, ""),
      many,
      `the timeline holds more ${JSON.stringify(kind)} events than the ${many} things that happened: ${await timelineInventory(this)}`,
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

Then(
  "the work's pull request section should give GitHub's merge answer as {string}",
  async function (this: KoluWorld, reason: string) {
    await openWorkCard(this);
    await pollFor({
      observe: async () =>
        (await workCard(this)
          .locator('[data-testid="work-pr"] [data-testid="work-pr-merge"]')
          .getAttribute("data-merge", { timeout: 1_000 })
          .catch(() => null)) ?? "(no merge answer on the card)",
      isDone: (seen) => seen === reason,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the pull request section never gave ${JSON.stringify(reason)}; after ${ms}ms it gave ${JSON.stringify(last)}`,
        ),
    });
  },
);

Then(
  "the work's timeline should show GitHub's merge answer as {string}",
  async function (this: KoluWorld, reason: string) {
    await openWorkCard(this);
    let inventoryAtTimeout = "(not observed)";
    await pollFor({
      observe: async () => {
        await reopenWorkCardAndUnfoldTimeline(this);
        return workCard(this)
          .locator(
            `[data-testid="work-event"][data-kind="merge-state"][data-merge="${reason}"]`,
          )
          .count();
      },
      isDone: (seen) => seen > 0,
      timeoutMs: POLL_TIMEOUT,
      onTick: async () => {
        inventoryAtTimeout = await timelineInventory(this);
      },
      onTimeout: (_last, ms) =>
        new Error(
          `no merge answer ${JSON.stringify(reason)} after ${ms}ms; the timeline holds ${inventoryAtTimeout}`,
        ),
    });
  },
);

Then(
  "the work's stage strip should be at {string}",
  async function (this: KoluWorld, stage: string) {
    await showWorkColumn(this);
    const strip = workCard(this).locator('[data-testid="stage-strip"]');
    await pollFor({
      observe: () =>
        strip
          .locator('[data-testid="stage"][data-state="now"]')
          .getAttribute("data-stage", { timeout: 1_000 })
          .catch(() => null),
      isDone: (seen) => seen === stage,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the strip was at ${JSON.stringify(last)} after ${ms}ms, not ${JSON.stringify(stage)}`,
        ),
    });
  },
);

When(
  "I press the {string} stage on the work's strip",
  async function (this: KoluWorld, stage: string) {
    await showWorkColumn(this);
    await workCard(this)
      .locator(
        `[data-testid="stage-strip"] [data-testid="stage"][data-stage="${stage}"] [data-testid="stage-cell"]`,
      )
      .click();
  },
);

Then(
  "the work card should show only its {string} events",
  async function (this: KoluWorld, stage: string) {
    const card = workCard(this);
    const timeline = card.locator(
      `[data-testid="work-timeline"][data-view="stage"][data-stage="${stage}"]`,
    );
    await timeline.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const shown = await timeline.locator('[data-testid="work-event"]').count();
    assert.ok(shown > 0, `the ${stage} stage shows no events`);
    const whole = (
      (await timeline
        .locator('[data-testid="work-timeline-whole"]')
        .textContent()) ?? ""
    ).match(/(\d+) events/);
    assert.ok(
      whole !== null && shown < Number(whole[1]),
      `the ${stage} stage shows ${shown} events, not fewer than the whole timeline`,
    );
    assert.equal(
      await card
        .locator(
          `[data-testid="stage"][data-stage="${stage}"] [data-testid="stage-cell"]`,
        )
        .getAttribute("aria-pressed"),
      "true",
    );
  },
);

Then(
  "the work card should link the pull request {string}",
  async function (this: KoluWorld, pr: string) {
    await openWorkCard(this);
    const link = workCard(this)
      .locator('[data-testid="work-pr"] [data-testid="work-pr-link"]')
      .filter({ hasText: pr })
      .first();
    await link.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const href = (await link.getAttribute("href")) ?? "";
    assert.ok(
      href.endsWith(`/pull/${pr.replace("#", "")}`),
      `the link goes to ${JSON.stringify(href)}`,
    );
  },
);

async function waitsOnYouNow(
  world: KoluWorld,
): Promise<{ who: string; inWaiting: boolean }> {
  const card = workCard(world);
  const who = (await card.getAttribute("data-who").catch(() => null)) ?? "";
  const id = (await card.getAttribute("data-work").catch(() => null)) ?? "";
  const inWaiting =
    id !== "" &&
    (await world.page
      .locator(
        `${WORK_COLUMN} [data-testid="work-waiting"] ${WORK_CARD}[data-work="${id}"]`,
      )
      .count()) > 0;
  return { who, inWaiting };
}

Then("the work should be waiting on you", async function (this: KoluWorld) {
  await showWorkColumn(this);
  await pollFor({
    observe: () => waitsOnYouNow(this),
    isDone: (seen) => seen.who === "you" && seen.inWaiting,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `after ${ms}ms the card waited on ${JSON.stringify(last?.who)}, ${last?.inWaiting ? "in" : "outside"} the Waiting on you group`,
      ),
  });
});

Then("the work should not be waiting on you", async function (this: KoluWorld) {
  await showWorkColumn(this);
  const seen = await waitsOnYouNow(this);
  assert.ok(
    seen.who !== "you" && !seen.inWaiting,
    `the card waits on ${JSON.stringify(seen.who)}, ${seen.inWaiting ? "in" : "outside"} the Waiting on you group`,
  );
});

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

Then("the work should be in progress", async function (this: KoluWorld) {
  const id = this.workId;
  assert.ok(id, "this scenario never opened a work");
  await showWorkColumn(this);
  await waitForValue(
    "the work's state",
    async () => {
      const card = this.page.locator(
        `${WORK_COLUMN} ${WORK_CARD}[data-work="${id}"]`,
      );
      if ((await card.count()) === 0) return "no card at all";
      return (await card.getAttribute("data-state")) ?? "no state";
    },
    "open",
  );
  assert.equal(
    await this.page
      .locator(
        `${WORK_COLUMN} [data-testid="work-finished"] ${WORK_CARD}[data-work="${id}"]`,
      )
      .count(),
    0,
    "the work in progress is drawn below the Finished line",
  );
});

When("I stop the work from the card", async function (this: KoluWorld) {
  await openWorkCard(this);
  const card = workCard(this);
  await card.locator('[data-testid="work-stop"]').click();
  const confirm = card.locator('[data-testid="work-stop-confirm"]');
  await confirm.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await confirm.click();
});

Then(
  "the work card should say it was stopped by you",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    await waitForValue(
      "the stopped card's outcome",
      async () =>
        (
          (await workCard(this)
            .locator('[data-testid="work-outcome"]')
            .textContent({ timeout: 1_000 })
            .catch(() => null)) ?? "(no outcome on the card)"
        )
          .replace(/\s+/g, " ")
          .includes("Stopped by you")
          ? "stopped by you"
          : "something else",
      "stopped by you",
    );
  },
);

Then(
  "the work card should show no terminals",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    const card = workCard(this);
    await waitForValue(
      "the terminals section of a finished card",
      async () =>
        (await card.locator('[data-testid="work-terminals"]').count()) === 0
          ? "none"
          : "a terminals section",
      "none",
    );
    assert.equal(
      await card.locator('[data-testid="work-question"]').count(),
      0,
      "a finished card is drawing an open question",
    );
  },
);

When("I reopen the work from the card", async function (this: KoluWorld) {
  await openWorkCard(this);
  await workCard(this).locator('[data-testid="work-reopen"]').click();
});

When(
  "I ask the conductor to open the work {string} again",
  async function (this: KoluWorld, title: string) {
    const opened = (): Promise<string[]> =>
      this.page
        .locator(`${TRANSCRIPT} ${ROW}[data-row-kind="agent"]`)
        .evaluateAll((rows) =>
          rows
            .map((row) => /opened:\s*(\S+)/.exec(row.textContent ?? "")?.[1])
            .filter((one): one is string => one !== undefined),
        );
    const before = (await opened()).length;
    await enterConductor(this);
    await sendPrompt(this, openWords(this, title));
    const said = await pollFor({
      observe: opened,
      isDone: (all) => all.length > before,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (all, ms) =>
        new Error(
          `the conductor never said what the second open answered after ${ms}ms; it has said ${JSON.stringify(all)}`,
        ),
    });
    this.workIdAgain = said.at(-1);
  },
);

Then(
  "the conductor should have answered with the same work",
  function (this: KoluWorld) {
    assert.ok(this.workId, "this scenario never opened a work");
    assert.equal(
      this.workIdAgain,
      this.workId,
      "opening the same branch twice answered two different works",
    );
  },
);

Then(
  "the work column should hold exactly one card for the work",
  async function (this: KoluWorld) {
    const id = this.workId;
    assert.ok(id, "this scenario never opened a work");
    await showWorkColumn(this);
    await waitForValue(
      "how many cards the column holds for this work",
      async () =>
        String(
          await this.page
            .locator(`${WORK_COLUMN} ${WORK_CARD}[data-work="${id}"]`)
            .count(),
        ),
      "1",
    );
    const title = this.workTitle;
    if (title !== undefined)
      assert.equal(
        await this.page
          .locator(`${WORK_COLUMN} ${WORK_CARD}`)
          .filter({ hasText: title })
          .count(),
        1,
        "the column holds a second card titled like this work",
      );
  },
);

When(
  "I decline the work's question on the card",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    const ask = workCard(this).locator('[data-testid="work-question"]');
    await ask.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await ask.locator('[data-testid="conductor-ask-dismiss"]').click();
  },
);

Then(
  "the work column should not show the work",
  async function (this: KoluWorld) {
    const id = this.workId;
    assert.ok(id, "this scenario never opened a work");
    await showWorkColumn(this);
    await waitForCount(
      this,
      `${WORK_COLUMN} ${WORK_CARD}[data-work="${id}"]`,
      0,
    );
  },
);

Then(
  "the work's decisions should include {string} answered from the {word}",
  async function (this: KoluWorld, text: string, from: string) {
    await waitForDecision(
      this,
      text,
      `[data-from="${from}"]`,
      `from the ${from}`,
    );
  },
);

Then(
  "the work's decisions should include {string}",
  async function (this: KoluWorld, text: string) {
    await waitForDecision(this, text, "", "");
  },
);

async function waitForDecision(
  world: KoluWorld,
  text: string,
  narrowed: string,
  said: string,
): Promise<void> {
  await openWorkCard(world);
  await pollFor({
    observe: async () => {
      const unfold = workCard(world).locator(
        '[data-testid="work-decisions-all"][aria-expanded="false"]',
      );
      if ((await unfold.count()) > 0) await unfold.click().catch(() => {});
      return world.page
        .locator(
          `${WORK_COLUMN} [data-testid="work-setup-part"]${narrowed}, ${WORK_COLUMN} [data-testid="work-decision"]${narrowed}`,
        )
        .evaluateAll((all) =>
          all.map(
            (one) =>
              `${one.getAttribute("data-answer") ?? ""} ${(one.textContent ?? "").replace(/\s+/g, " ").trim()}`,
          ),
        );
    },
    isDone: (read) => read.some((one) => one.includes(text)),
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (read, ms) =>
      new Error(
        `no decision ${said === "" ? "" : `answered ${said} `}reads ${JSON.stringify(text)} after ${ms}ms; the card holds ${JSON.stringify(read)}`,
      ),
  });
}

Then(
  "the work's decisions should be one line each",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    const setup = workCard(this).locator('[data-testid="work-setup"]');
    await setup.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const wrapped = await workCard(this)
      .locator('[data-testid="work-setup"], [data-testid="work-decision-row"]')
      .evaluateAll((all) =>
        all
          .map((one) => {
            const style = getComputedStyle(one);
            const line =
              Number.parseFloat(style.lineHeight) ||
              Number.parseFloat(style.fontSize) * 1.5;
            return one.getBoundingClientRect().height > line * 1.5
              ? (one.textContent ?? "").replace(/\s+/g, " ").trim()
              : "";
          })
          .filter((one) => one !== ""),
      );
    if (wrapped.length > 0)
      throw new Error(
        `these decision lines take more than one line: ${JSON.stringify(wrapped)}`,
      );
  },
);

Then(
  "the work's terminal rows should each be one line",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    const rows = workCard(this).locator(
      '[data-testid="work-member"] [data-testid="conductor-look"] > div',
    );
    await rows.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const broken = await rows.evaluateAll((all) =>
      all
        .map((row) => {
          const tops = Array.from(row.children)
            .filter((one) => one.getBoundingClientRect().width > 0)
            .map((one) => {
              const box = one.getBoundingClientRect();
              return box.top + box.height / 2;
            });
          const oneLine = tops.every(
            (mid) => Math.abs(mid - (tops[0] ?? 0)) < 6,
          );
          const fits = row.scrollWidth <= row.clientWidth + 1;
          return oneLine && fits
            ? ""
            : `${oneLine ? "" : "wraps "}${fits ? "" : "overflows "}${(row.textContent ?? "").replace(/\s+/g, " ").trim()}`;
        })
        .filter((one) => one !== ""),
    );
    if (broken.length > 0)
      throw new Error(
        `these terminal rows are not one line: ${JSON.stringify(broken)}`,
      );
  },
);

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
    await openWorkCard(this);
    await this.page
      .locator(
        `${WORK_COLUMN} [data-testid="work-file"][data-path="${file}"][data-kept]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the work card should show the folder {string} holding {int} files",
  async function (this: KoluWorld, folder: string, count: number) {
    await openWorkCard(this);
    await this.page
      .locator(
        `${WORK_COLUMN} [data-testid="work-folder"][data-path="${folder}"][data-count="${count}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I unfold the work's folder {string}",
  async function (this: KoluWorld, folder: string) {
    await openWorkCard(this);
    const chip = this.page.locator(
      `${WORK_COLUMN} [data-testid="work-folder"][data-path="${folder}"]`,
    );
    await chip.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    if ((await chip.getAttribute("aria-expanded")) !== "true")
      await chip.click();
    await this.page
      .locator(
        `${WORK_COLUMN} [data-testid="work-folder"][data-path="${folder}"][aria-expanded="true"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the work's timeline should show one row for the folder {string} with {int} files",
  async function (this: KoluWorld, folder: string, count: number) {
    await showWorkColumn(this);
    await openWorkCard(this);
    await reopenWorkCardAndUnfoldTimeline(this);
    const rows = workCard(this).locator(
      `[data-testid="work-event-folder"][data-path="${folder}"]`,
    );
    await waitForValue(
      "the timeline's rows for the folder",
      async () =>
        (await rows.allTextContents())
          .map((text) => (text.includes(`${count} files`) ? "match" : text))
          .join("|"),
      "match",
    );
  },
);

When(
  "I unfold the work's timeline row for the folder {string}",
  async function (this: KoluWorld, folder: string) {
    await showWorkColumn(this);
    await openWorkCard(this);
    await reopenWorkCardAndUnfoldTimeline(this);
    const more = workCard(this).locator(
      `[data-testid="work-event-folder"][data-path="${folder}"] > div > [data-testid="work-event-more"]`,
    );
    await more.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    if ((await more.getAttribute("aria-expanded")) !== "true")
      await more.click();
  },
);

Then(
  "the folder row {string} should list {int} file rows",
  async function (this: KoluWorld, folder: string, count: number) {
    await waitForCount(
      this,
      `${WORK_COLUMN} [data-testid="work-event-folder"][data-path="${folder}"] [data-testid="work-event"][data-kind="file"]`,
      count,
    );
  },
);

Then(
  "the reader should render {string} as a heading",
  async function (this: KoluWorld, heading: string) {
    const view = this.page.locator('[data-testid="reader-doc"]');
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
    const reads = ((await mark.getAttribute("title")) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    assert.ok(
      reads.includes(title),
      `the dock row's mark is titled ${JSON.stringify(reads)}, which does not name the work ${JSON.stringify(title)}`,
    );
  },
);

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

When(
  "the kolu server is restarted over works this build cannot read",
  { timeout: 180_000 },
  async function (this: KoluWorld) {
    const url = await restartKoluServer((stateFile) => {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Record<
        string,
        unknown
      >;
      state.works = [{ id: "work:unreadable", title: 7 }];
      fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
    });
    await this.page.goto(url);
  },
);

Then(
  "the conductor should say it could not read the saved works",
  async function (this: KoluWorld) {
    const refusal = this.page.locator('[data-testid="conductor-refusal"]');
    await refusal.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const said = (await refusal.innerText()).replace(/\s+/g, " ");
    assert.ok(
      said.includes("kolu could not read the Conductor's saved works"),
      `the refusal reads ${JSON.stringify(said)}`,
    );
    assert.ok(
      !/fix the .works. key/i.test(said),
      `the refusal still asks for a hand-edit: ${JSON.stringify(said)}`,
    );
    assert.equal(await this.page.locator(INPUT).count(), 0);
  },
);

When(
  "I restore the newest backup that reads",
  async function (this: KoluWorld) {
    const button = this.page.locator(
      '[data-testid="conductor-recover-backup"]',
    );
    await button.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await button.click();
    await this.page
      .locator('[data-testid="conductor-refusal"]')
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

const IDENTITY = '[data-testid="conductor-identity"]';
const SIGN_IN_ROW = '[data-testid="conductor-signin"]';

const accountShown = async (world: KoluWorld): Promise<string> =>
  ((await world.page.locator(IDENTITY).textContent()) ?? "").trim();

When("I note the conductor's account", async function (this: KoluWorld) {
  await enterConductor(this);
  await this.page
    .locator(IDENTITY)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  this.notedAccount = await accountShown(this);
  assert.notEqual(this.notedAccount, "", "the account chip says nothing");
});

When(
  "I ask to sign in again from the conductor menu",
  async function (this: KoluWorld) {
    await enterConductor(this);
    await this.page.locator(MENU).click();
    await waitForAtLeastOne(this, MENU_PANEL);
    const door = this.page.locator('[data-testid="conductor-menu-signin"]');
    assert.equal((await door.textContent())?.trim(), "Sign in again…");
    await door.click();
  },
);

Then(
  "the sign-in row I asked for should offer {string}",
  async function (this: KoluWorld, name: string) {
    const row = this.page.locator(`${SIGN_IN_ROW}[data-cause="person"]`);
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await row
      .locator('[data-testid="conductor-signin-method"]', { hasText: name })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I sign in with {string}", async function (this: KoluWorld, name: string) {
  await this.page
    .locator(`${SIGN_IN_ROW} [data-testid="conductor-signin-method"]`, {
      hasText: name,
    })
    .click();
});

When("I close the sign-in row", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="conductor-signin-close"]').click();
});

Then("there should be no sign-in row", async function (this: KoluWorld) {
  await waitForCount(this, SIGN_IN_ROW, 0);
});

Then(
  "the conductor's account should have moved on",
  async function (this: KoluWorld) {
    const was = this.notedAccount;
    assert.ok(was, "no account was noted before the sign-in");
    await pollFor({
      observe: () => accountShown(this),
      isDone: (now) => now !== "" && now !== was,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (now, ms) =>
        new Error(
          `after ${ms}ms the account chip still reads ${JSON.stringify(now)} (it read ${JSON.stringify(was)} before the sign-in)`,
        ),
    });
  },
);

Then(
  "the conductor's account should be the one I noted",
  async function (this: KoluWorld) {
    assert.equal(await accountShown(this), this.notedAccount);
  },
);

Then(
  "the conductor should answer as the account it shows",
  async function (this: KoluWorld) {
    const shown = await accountShown(this);
    await waitForAtLeastOne(
      this,
      `${TRANSCRIPT} ${ROW}[data-row-kind="agent"]:has-text(${JSON.stringify(`you are ${shown}`)})`,
    );
  },
);

Then(
  "the refused message should offer to sign in again",
  async function (this: KoluWorld) {
    await this.page
      .locator(
        '[data-testid="conductor-user-mark"][data-mark="refused"][data-sign-in="account"]',
      )
      .last()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator('[data-testid="conductor-mark-signin"]')
      .last()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I press sign in again beside the refused message",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="conductor-mark-signin"]')
      .last()
      .click();
  },
);
