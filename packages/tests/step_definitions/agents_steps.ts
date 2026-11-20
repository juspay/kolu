import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { agentBundleShortHash } from "@kolu/agent-distro/bundle";
import type {
  AgentDistroReceipt,
  AgentDistroSetting,
  AgentDistroStatus,
} from "@kolu/agent-distro/schema";
import {
  AGENTS_OFF_MEANS,
  type AgentHostDetail,
  agentHostDetail,
  agentMarkOf,
  agentsChosenLabel,
  agentsResolvedLine,
  agentsStepHint,
  agentToast,
  agentUpdateFailedLine,
  type HostAgentStatus,
  JUSPAY_PROFILE,
  restartedLabel,
} from "@kolu/agent-distro/status";
import { failedUpdateLine } from "@kolu/agent-distro/testing";
import {
  FIXTURE_CLAUDE_SAYS,
  FIXTURE_LISTING,
  FIXTURE_MARK,
  FIXTURE_PICKER_SAYS,
  fixtureHistoryLog,
} from "../support/agentDistroFixture.ts";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";
import { stateHomeDir } from "../support/hooks.ts";
import { waitForPadiCell } from "../support/padiCellWait.ts";
import { escapeRegExp } from "../support/regexp.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const FOCUSED_TILE = '[data-testid="canvas-tile"]:has([data-focused])';

const IN_SETTINGS = '[data-testid="settings-popover"]';
const FIRST_RUN = '[data-testid="welcome-moment-choose-agents"]';

const row = (reference: string, scope = IN_SETTINGS) =>
  `${scope} [data-testid="agents-profile-row"][data-reference="${reference}"]`;

const HOST_DETAILS = '[data-testid="host-diagnostics-popover"]';
const AGENTS_STATE = `${HOST_DETAILS} [data-testid="host-agents-state-text"]`;

const HOST_AGENTS_MARK =
  '[data-testid="host-chip-row"] [data-testid="host-agents-mark"]';

const LOCAL_NAME = os.hostname();

const stackOf = (text: string): string[] =>
  text.split(/\s+/).filter((r) => r !== "");

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

async function switchOn(world: KoluWorld): Promise<boolean> {
  const sw = world.page.locator(`${IN_SETTINGS} [data-testid="agents-switch"]`);
  await sw.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  return (await sw.getAttribute("aria-checked")) === "true";
}

async function waitForSwitch(world: KoluWorld, on: boolean): Promise<void> {
  await world.page
    .locator(
      `${IN_SETTINGS} [data-testid="agents-switch"][aria-checked="${on}"]`,
    )
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

async function setSwitch(world: KoluWorld, on: boolean): Promise<void> {
  if ((await switchOn(world)) !== on)
    await world.page.click(`${IN_SETTINGS} [data-testid="agents-switch"]`);
  await waitForSwitch(world, on);
}

export async function turnAgentsOnReady(world: KoluWorld): Promise<void> {
  const handle = world.page.locator('[data-testid="mobile-pull-handle"]');
  const onPhone = await handle.isVisible();
  if (onPhone) await handle.click();
  await world.page.click('[data-testid="settings-trigger"]');
  await setSwitch(world, true);
  await readyWithNoProfiles();
  await world.page.keyboard.press("Escape");
  await world.page
    .locator(IN_SETTINGS)
    .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  if (!onPhone) return;
  const sheet = world.page.locator('[data-testid="mobile-chrome-sheet"]');
  if (await sheet.isVisible()) await world.page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
}

Then(
  "the Agents switch in Settings should be {word}",
  async function (this: KoluWorld, state: string) {
    assert.ok(state === "on" || state === "off", `on|off, got ${state}`);
    await waitForSwitch(this, state === "on");
  },
);

When("I turn Agents {word}", async function (this: KoluWorld, state: string) {
  assert.ok(state === "on" || state === "off", `on|off, got ${state}`);
  await setSwitch(this, state === "on");
});

Then("the Agents hint should explain Off", async function (this: KoluWorld) {
  await this.page
    .locator(IN_SETTINGS)
    .getByText(AGENTS_OFF_MEANS, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the Agents row should name the agents it would bring",
  async function (this: KoluWorld) {
    for (const harness of FIXTURE_LISTING.harnesses)
      await this.page
        .locator(
          `${IN_SETTINGS} [data-testid="agents-chip"][data-agent="${harness.title}"]`,
        )
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

async function toastSays(world: KoluWorld, text: string): Promise<void> {
  await world.page
    .locator("[data-sonner-toaster] [data-title]")
    .filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) })
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

Then(
  "a toast should say new terminals get the coding agents",
  async function (this: KoluWorld) {
    await toastSays(this, agentToast.on([]));
  },
);

Then(
  "a toast should say new terminals get the coding agents with {string}",
  async function (this: KoluWorld, stack: string) {
    await toastSays(this, agentToast.on(stackOf(stack)));
  },
);

Then("a toast should say agents are off", async function (this: KoluWorld) {
  await toastSays(this, agentToast.off);
});

Then(
  "a toast should say the terminal restarted as a plain shell",
  async function (this: KoluWorld) {
    await toastSays(
      this,
      restartedLabel({ agents: undefined, resumed: false }),
    );
  },
);

async function settingsList(world: KoluWorld): Promise<void> {
  await world.page
    .locator(`${IN_SETTINGS} [data-testid="agents-profiles"]`)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

async function waitForRows(
  world: KoluWorld,
  scope: string,
  expected: readonly string[],
): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT;
  let seen: string[] = [];
  while (Date.now() < deadline) {
    seen = await world.page
      .locator(`${scope} [data-testid="agents-profile-row"]`)
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-reference")))
      .then((refs) => refs.map((r) => r ?? ""));
    if (sameList(seen, expected)) return;
    await world.page.waitForTimeout(50);
  }
  assert.fail(
    `profile rows: expected ${JSON.stringify(expected)}, saw ${JSON.stringify(seen)}`,
  );
}

Then(
  "the Agents profile list should be empty",
  async function (this: KoluWorld) {
    await settingsList(this);
    await waitForRows(this, IN_SETTINGS, []);
    await this.page
      .locator(`${IN_SETTINGS} [data-testid="agents-profile-repo"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Agents profile list should not show",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${IN_SETTINGS} [data-testid="agents-profiles"]`)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Agents profile list should end with the repository row",
  async function (this: KoluWorld) {
    await settingsList(this);
    const last = this.page.locator(
      `${IN_SETTINGS} [data-testid="agents-profiles"] ol > li:last-child`,
    );
    assert.strictEqual(
      await last.getAttribute("data-testid", { timeout: POLL_TIMEOUT }),
      "agents-profile-repo",
      "the list does not end with the repository row",
    );
    assert.strictEqual(
      await last.locator("button").count(),
      0,
      "the repository row can be moved or removed",
    );
    await last
      .locator("a")
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Agents profile rows should be {string}",
  async function (this: KoluWorld, stack: string) {
    await waitForRows(this, IN_SETTINGS, stackOf(stack));
  },
);

Then(
  "the {string} profile row should be resolving",
  async function (this: KoluWorld, reference: string) {
    const line = agentsResolvedLine(reference, undefined);
    assert.strictEqual(line.kind, "pending");
    await this.page
      .locator(
        `${row(reference)} [data-testid="agents-resolved"][data-kind="pending"]`,
      )
      .filter({ hasText: new RegExp(`^${escapeRegExp(line.text)}$`) })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

async function focusField(world: KoluWorld, scope: string) {
  const input = world.page.locator(
    `${scope} [data-testid="agents-profile-input"]`,
  );
  await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await input.blur();
  await input.focus();
  return input;
}

const JUSPAY_OPTION = `[data-testid="agents-profile-option"][data-value="${JUSPAY_PROFILE}"]`;

async function juspayOffered(world: KoluWorld, offered: boolean) {
  await settingsList(world);
  const input = await focusField(world, IN_SETTINGS);
  await world.page.locator(JUSPAY_OPTION).waitFor({
    state: offered ? "visible" : "detached",
    timeout: POLL_TIMEOUT,
  });
  await input.press("Escape");
}

Then("the Juspay profile should be offered", async function (this: KoluWorld) {
  await juspayOffered(this, true);
});

Then(
  "the Juspay profile should not be offered",
  async function (this: KoluWorld) {
    await juspayOffered(this, false);
  },
);

async function addJuspay(world: KoluWorld, scope: string) {
  await focusField(world, scope);
  await world.page.click(JUSPAY_OPTION);
  await world.waitForFrame();
}

When("I add the Juspay profile", async function (this: KoluWorld) {
  await settingsList(this);
  await addJuspay(this, IN_SETTINGS);
});

When(
  "I add the {string} profile",
  async function (this: KoluWorld, reference: string) {
    const input = this.page.locator(
      `${IN_SETTINGS} [data-testid="agents-profile-input"]`,
    );
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.fill(reference);
    await input.press("Enter");
    await this.waitForFrame();
  },
);

When(
  "I move the {string} profile {word}",
  async function (this: KoluWorld, reference: string, way: string) {
    assert.ok(way === "up" || way === "down", `up|down, got ${way}`);
    await this.page.click(
      `${row(reference)} [data-testid="agents-profile-${way}"]`,
    );
    await this.waitForFrame();
  },
);

When(
  "I remove the {string} profile",
  async function (this: KoluWorld, reference: string) {
    await this.page.click(
      `${row(reference)} [data-testid="agents-profile-remove"]`,
    );
    await this.waitForFrame();
  },
);

async function storedIs(
  accept: (s: AgentDistroSetting) => boolean,
  what: string,
): Promise<void> {
  await waitForPadiCell({
    memberVerb: "agentDistro/get",
    accept: (v) => accept(v as AgentDistroSetting),
    what,
    timeoutMs: POLL_TIMEOUT,
  });
}

Then(
  "the stored Agents profiles should be {string}",
  async function (this: KoluWorld, stack: string) {
    const expected = stackOf(stack);
    await storedIs(
      (s) => s.enabled && sameList(s.profiles, expected),
      `the stored Agents profiles ${JSON.stringify(expected)}`,
    );
  },
);

Then(
  "the stored Agents profiles should be empty",
  async function (this: KoluWorld) {
    await storedIs(
      (s) => s.enabled && s.profiles.length === 0,
      "agents on with no profiles",
    );
  },
);

Then(
  "Agents should still be off with no profiles",
  async function (this: KoluWorld) {
    await storedIs(
      (s) => !s.enabled && s.profiles.length === 0,
      "agents off with no profiles",
    );
  },
);

async function padiValue<T>(
  memberVerb: string,
  accept: (v: T) => boolean,
  what: string,
): Promise<T> {
  let seen: T | undefined;
  await waitForPadiCell({
    memberVerb,
    accept: (v) => {
      if (!accept(v as T)) return false;
      seen = v as T;
      return true;
    },
    what,
    timeoutMs: POLL_TIMEOUT,
  });
  if (seen === undefined) throw new Error(`no value for ${what}`);
  return seen;
}

async function readyWithNoProfiles(): Promise<
  Extract<AgentDistroStatus, { kind: "ready" }>
> {
  const status = await padiValue<AgentDistroStatus>(
    "agentDistroStatus/get",
    (s) => s.kind === "ready" && s.set.profiles.length === 0,
    "the agents ready with no profiles",
  );
  if (status.kind !== "ready") throw new Error("not ready");
  return status;
}

Then("padi should give new terminals the agents with no profiles", async () => {
  await readyWithNoProfiles();
});

Then(
  "padi should give new terminals no agents for {string}",
  async (stack: string) => {
    const expected = stackOf(stack);
    await waitForPadiCell({
      memberVerb: "agentDistroStatus/get",
      accept: (s) => {
        const status = s as AgentDistroStatus;
        return (
          status.kind === "undelivered" && sameList(status.profiles, expected)
        );
      },
      what: `no agents delivered for ${JSON.stringify(expected)}`,
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then("padi should give new terminals no agents", async () => {
  await waitForPadiCell({
    memberVerb: "agentDistroStatus/get",
    accept: (s) => (s as AgentDistroStatus).kind === "off",
    what: "agents off",
    timeoutMs: POLL_TIMEOUT,
  });
});

Then(
  "the host tab's agents mark should be {string}",
  async function (this: KoluWorld, state: string) {
    await this.page
      .locator(`${HOST_AGENTS_MARK}[data-state="${state}"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the host tab should show no agents mark",
  async function (this: KoluWorld) {
    await this.page
      .locator(HOST_AGENTS_MARK)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the host tab's agents mark should not be on screen",
  async function (this: KoluWorld) {
    await this.page
      .locator(HOST_AGENTS_MARK)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

When("I click the host tab's agents mark", async function (this: KoluWorld) {
  await this.page.click(HOST_AGENTS_MARK);
  await this.page
    .locator(HOST_DETAILS)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the Agents fleet line should say this machine is ready",
  async function (this: KoluWorld) {
    assert.ok(await switchOn(this), "Agents are off; there is nothing ready");
    const group = this.page.locator(
      `${IN_SETTINGS} [data-testid="agents-fleet-group"][data-tone="ok"]`,
    );
    await group.first().waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await group
      .locator(`[data-testid="agents-fleet-host"][data-host="${LOCAL_NAME}"]`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click this machine's name on the Agents fleet line",
  async function (this: KoluWorld) {
    await this.page.click(
      `${IN_SETTINGS} [data-testid="agents-fleet-host"][data-host="${LOCAL_NAME}"]`,
    );
    await this.page
      .locator(HOST_DETAILS)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "this machine's host details should show its agents section",
  async function (this: KoluWorld) {
    await this.page
      .locator(AGENTS_STATE)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the agents section should name no profiles with the build it serves",
  async function (this: KoluWorld) {
    const profiles = this.page.locator(
      `${HOST_DETAILS} [data-testid="host-agents-profile"][data-profile=""]`,
    );
    await profiles.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const status = await readyWithNoProfiles();
    assert.match(
      await profiles.innerText(),
      new RegExp(escapeRegExp(agentBundleShortHash(status.set.bundle))),
    );
  },
);

Then(
  "the agents section should offer to check for newer agents",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${HOST_DETAILS} [data-testid="host-agents-action"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the agents section names this machine by its hostname",
  async function (this: KoluWorld) {
    await this.page
      .locator(
        `${HOST_DETAILS} [data-testid="host-agents"][data-host="${LOCAL_NAME}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

const FAILED_UPDATE_WORDS = `nix build exited 1: /nix/store/${"q".repeat(32)}-agent-distro-claude-code-2.1.319-with-plugins.drv could not be realised — no space left on device`;

let seededHistoryLog: string | undefined;

After(() => {
  if (seededHistoryLog !== undefined)
    fs.rmSync(seededHistoryLog, { force: true });
  seededHistoryLog = undefined;
});

Given(
  "this machine's agents update log records a failed update",
  function (this: KoluWorld) {
    const file = fixtureHistoryLog(stateHomeDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, failedUpdateLine(FAILED_UPDATE_WORDS));
    seededHistoryLog = file;
  },
);

async function failedUpdateHost(): Promise<HostAgentStatus> {
  const status = await readyWithNoProfiles();
  const receipt = await padiValue<AgentDistroReceipt>(
    "agentDistroReceipt/get",
    (r) => r.lastRun?.outcome === "failed",
    "a receipt whose last run failed",
  );
  return {
    label: LOCAL_NAME,
    status,
    checking: false,
    receipt,
    ago: () => "",
  };
}

async function failedUpdateDetail(): Promise<AgentHostDetail> {
  const detail = agentHostDetail({
    host: await failedUpdateHost(),
    setting: { enabled: true, profiles: [] },
  });
  if (detail?.cause === undefined)
    throw new Error("the fold gives this machine no cause");
  return detail;
}

Then(
  "the agents section should say the last update failed",
  async function (this: KoluWorld) {
    const { state } = await failedUpdateDetail();
    const line = this.page.locator(AGENTS_STATE);
    await line.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.waitForFunction(
      ([sel, text]) =>
        document
          .querySelector(sel as string)
          ?.textContent?.startsWith(text as string),
      [AGENTS_STATE, state.text.trimEnd()],
      { timeout: POLL_TIMEOUT },
    );
    assert.strictEqual(
      await this.page
        .locator(`${HOST_DETAILS} [data-testid="host-agents-state"]`)
        .getAttribute("data-tone"),
      "warn",
    );
  },
);

Then(
  "the agents section should show that failure's cause in full",
  async function (this: KoluWorld) {
    const { cause } = await failedUpdateDetail();
    assert.ok(cause);
    assert.ok(
      cause.headline.includes(FAILED_UPDATE_WORDS),
      `the fold's cause ${JSON.stringify(cause.headline)} is not the seeded words`,
    );
    const text = this.page.locator(
      `${HOST_DETAILS} [data-testid="host-agents-cause-text"]`,
    );
    await text.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(
      await text.textContent(),
      `${cause.by}: ${cause.headline}`,
    );
    const overflow = await this.page
      .locator(HOST_DETAILS)
      .evaluate((el) => el.scrollWidth - el.clientWidth);
    assert.ok(
      overflow <= 0,
      `the host details scroll sideways by ${overflow}px`,
    );
  },
);

Then(
  "the host tab's agents mark should warn that its last update failed",
  async function (this: KoluWorld) {
    const host = await failedUpdateHost();
    const mark = agentMarkOf(host.status, host.checking, host.receipt);
    assert.ok(
      mark.kind === "ready" && mark.updateFailed !== undefined,
      "the fold gives this machine no failed update",
    );
    const failure = mark.updateFailed;
    const tab = this.page.locator(
      `${HOST_AGENTS_MARK}[data-state="ready"][data-update-failed]`,
    );
    await tab.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.ok(
      (await tab.getAttribute("aria-label"))?.includes(
        agentUpdateFailedLine(failure, LOCAL_NAME),
      ),
      "the mark's words do not say the update failed",
    );
  },
);

const PILL = `${FOCUSED_TILE} [data-testid="tile-agent-chip"]`;

Then(
  "the focused tile's agents chip should show only the build it serves",
  async function (this: KoluWorld) {
    const status = await readyWithNoProfiles();
    const pill = this.page.locator(
      `${PILL}[data-hash="${agentBundleShortHash(status.set.bundle)}"]`,
    );
    await pill.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(
      await pill.getAttribute("data-profile"),
      null,
      "the pill names a profile",
    );
    assert.strictEqual(
      await pill.locator('[data-testid="tile-agent-profile"]').count(),
      0,
      "the pill shows a profile",
    );
  },
);

When(
  "I click the focused tile's agents chip",
  async function (this: KoluWorld) {
    await this.page.click(PILL);
    await this.waitForFrame();
  },
);

Then(
  "the focused tile should show no agents chip",
  async function (this: KoluWorld) {
    await this.page
      .locator(FOCUSED_TILE)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator(PILL)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the terminal's AI_PROFILE should be unset",
  async function (this: KoluWorld) {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a SHELL expansion, typed into the terminal as is.
    await this.terminalRunAndWait('echo "ai-profile=[${AI_PROFILE-un}set]"');
    await waitForBufferContains(this.page, `ai-profile=[${"un"}set]`);
  },
);

Then(
  "the terminal's claude should be the fixture",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait("claude");
    await waitForBufferContains(this.page, FIXTURE_CLAUDE_SAYS);
  },
);

Then(
  "the terminal's agent-distro should be the fixture picker",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait("agent-distro");
    await waitForBufferContains(this.page, FIXTURE_PICKER_SAYS);
  },
);

Then(
  "the terminal should have no fixture agents on its PATH",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait(
      `echo "fixture-agents=$(command -v claude | grep -c ${FIXTURE_MARK})"`,
    );
    await waitForBufferContains(this.page, "fixture-agents=0");
  },
);

const rememberedTile = new WeakMap<KoluWorld, string>();

async function focusedTerminalId(world: KoluWorld): Promise<string> {
  const id = await world.page
    .locator(FOCUSED_TILE)
    .getAttribute("data-terminal-id", { timeout: POLL_TIMEOUT });
  assert.ok(id, "the focused tile has no terminal id");
  return id;
}

When("I remember the focused tile", async function (this: KoluWorld) {
  rememberedTile.set(this, await focusedTerminalId(this));
});

Then(
  "the focused tile should be the one I remembered",
  async function (this: KoluWorld) {
    assert.strictEqual(await focusedTerminalId(this), rememberedTile.get(this));
  },
);

Then(
  "the focused tile's agents chip should be stale without a Restart button",
  async function (this: KoluWorld) {
    const pill = this.page.locator(`${PILL}[data-stale]`);
    await pill.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(
      await pill.getAttribute("data-restart"),
      null,
      "the pill offers a restart into no agents",
    );
    assert.strictEqual(
      await pill.locator('[data-testid="tile-agent-restart"]').count(),
      0,
      "the pill shows a Restart",
    );
  },
);

Then(
  "the focused tile's agents chip should be stale with a Restart button",
  async function (this: KoluWorld) {
    await this.page
      .locator(
        `${PILL}[data-stale][data-restart] [data-testid="tile-agent-restart"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click Restart on the focused tile", async function (this: KoluWorld) {
  await this.page.click(`${PILL}[data-restart]`);
});

Then(
  "the focused tile should paint a fresh screen without {string}",
  async function (this: KoluWorld, old: string) {
    const deadline = Date.now() + POLL_TIMEOUT;
    let text = "";
    while (Date.now() < deadline) {
      text = await readBufferText(this.page);
      if (text.trim() !== "" && !text.includes(old)) return;
      await this.page.waitForTimeout(100);
    }
    assert.fail(
      `the restarted tile did not paint a fresh screen; its xterm holds: ${JSON.stringify(text.slice(-400))}`,
    );
  },
);

const TURN_ON = `${FIRST_RUN} [data-testid="welcome-agents-turn-on"]`;

Then(
  "the welcome card's first row should ask which agents I want",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () =>
        document
          .querySelector(
            '[data-testid="welcome-moments"] [data-testid^="welcome-moment-"]',
          )
          ?.getAttribute("data-testid") === "welcome-moment-choose-agents",
      undefined,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the first-run step should say what kolu can bring",
  async function (this: KoluWorld) {
    const lead = agentsStepHint(FIXTURE_LISTING);
    assert.ok(lead, "no words for the first-run step");
    await this.page
      .locator(FIRST_RUN)
      .getByText(lead, { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the first-run step should start with an empty list and Juspay one click away",
  async function (this: KoluWorld) {
    await waitForRows(this, FIRST_RUN, []);
    for (const id of [
      "agents-add-juspay",
      "agents-profile-repo",
      "agents-profile-input",
    ])
      await this.page
        .locator(`${FIRST_RUN} [data-testid="${id}"]`)
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the first-run step's profile list should be empty",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${FIRST_RUN} [data-testid="agents-profile-repo"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForRows(this, FIRST_RUN, []);
  },
);

When(
  "I add the Juspay profile in the first-run step",
  async function (this: KoluWorld) {
    await this.page.click(`${FIRST_RUN} [data-testid="agents-add-juspay"]`);
    await this.waitForFrame();
  },
);

Then(
  "the first-run step's profile rows should be {string}",
  async function (this: KoluWorld, stack: string) {
    await waitForRows(this, FIRST_RUN, stackOf(stack));
  },
);

When(
  "I turn agents on from the first-run step",
  async function (this: KoluWorld) {
    await this.page.click(TURN_ON);
    await this.waitForFrame();
  },
);

When("I press Not now on the first-run step", async function (this: KoluWorld) {
  await this.page.click(`${FIRST_RUN} [data-testid="welcome-agents-not-now"]`);
  await this.waitForFrame();
});

Then(
  "keyboard focus should be on the first-run Turn on button",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => document.activeElement === document.querySelector(sel),
      TURN_ON,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the first-run step should not have taken keyboard focus",
  async function (this: KoluWorld) {
    await this.page
      .locator(FIRST_RUN)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 250)),
          ),
        ),
    );
    const inside = await this.page.evaluate(
      (sel) =>
        document.querySelector(sel)?.contains(document.activeElement) ?? false,
      FIRST_RUN,
    );
    assert.strictEqual(inside, false, "the first-run step took the focus");
  },
);

Then(
  "the welcome card should not ask about agents",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="welcome-moments"]')
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator(FIRST_RUN)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the welcome card's done line should say agents are on",
  async function (this: KoluWorld) {
    const label = agentsChosenLabel(
      { enabled: true, profiles: [] },
      FIXTURE_LISTING,
      undefined,
    );
    assert.ok(label, "agents on has a done line");
    await this.page
      .locator('[data-testid="welcome-moments-done"]')
      .filter({ hasText: label })
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the welcome card's done line should not mention agents",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="welcome-moments"]')
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(
      await this.page
        .locator('[data-testid="welcome-moments-done"]')
        .filter({ hasText: /Agents/ })
        .count(),
      0,
      "the done line names agents while they are off",
    );
  },
);

Then(
  "the Tutorial should ask which agents I want",
  async function (this: KoluWorld) {
    await this.page
      .locator(`[data-testid="welcome-dialog"] ${FIRST_RUN}`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Tutorial should not ask about agents",
  async function (this: KoluWorld) {
    await this.page
      .locator('[data-testid="welcome-dialog"] [data-testid="welcome-moments"]')
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator(`[data-testid="welcome-dialog"] ${FIRST_RUN}`)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

When(
  "I start watching for the first-run step",
  async function (this: KoluWorld) {
    await this.page.addInitScript((sel) => {
      const w = window as unknown as { __firstRunStepSeen?: boolean };
      w.__firstRunStepSeen = false;
      new MutationObserver(() => {
        if (document.querySelector(sel)) w.__firstRunStepSeen = true;
      }).observe(document, { subtree: true, childList: true });
    }, FIRST_RUN);
  },
);

Then(
  "the first-run step should never have shown since",
  async function (this: KoluWorld) {
    const seen = await this.page.evaluate(
      () =>
        (window as unknown as { __firstRunStepSeen?: boolean })
          .__firstRunStepSeen,
    );
    assert.strictEqual(seen, false, "the first-run step flashed on reload");
  },
);
