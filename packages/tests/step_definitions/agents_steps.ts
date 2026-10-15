/**
 * Agents come with kolu — the choice (Settings → Agents and the welcome card's
 * first-run step), what the NEXT terminal gets, and what each MACHINE has
 * (its host details).
 *
 * The server runs with a fixture agent-distro bake (`support/agentDistroFixture.ts`):
 * agent-distro's ONE package as a floor, with a stub `claude` and a stub
 * `agent-distro` picker. It bakes no delivery, so kolu-server builds no
 * profile: an empty list serves the floor, and any profile in the list leaves
 * padi with no set for that stack (`undelivered`). The suite resets Agents to
 * NEVER CHOSEN (`null`, a fresh install) before every scenario; these steps
 * switch agents and edit the list, then read the result where a user would —
 * the welcome card's step, Settings' list and fleet line, a machine's host
 * details, the tile's pill and what runs in a terminal — and what padi itself
 * says it gives new terminals.
 *
 * The same chooser renders in Settings and in the welcome card's step, so every
 * lookup is SCOPED to the one it means. Every word a step expects comes from
 * `@kolu/agent-distro/status`, the very functions the UI words it with.
 */

import assert from "node:assert";
import os from "node:os";
import { Then, When } from "@cucumber/cucumber";
import { agentBundleShortHash } from "@kolu/agent-distro/bundle";
import type {
  AgentDistroSetting,
  AgentDistroStatus,
} from "@kolu/agent-distro/schema";
import {
  AGENTS_OFF_MEANS,
  agentToast,
  agentsChosenLabel,
  agentsResolvedLine,
  agentsStepHint,
  restartedLabel,
} from "@kolu/agent-distro/status";
import {
  FIXTURE_CLAUDE_SAYS,
  FIXTURE_LISTING,
  FIXTURE_MARK,
  FIXTURE_PICKER_SAYS,
} from "../support/agentDistroFixture.ts";
import { waitForPadiCell } from "../support/padiCellWait.ts";
import { escapeRegExp } from "../support/regexp.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";

/** The focused tile — the one a just-created terminal lands in. */
const FOCUSED_TILE = '[data-testid="canvas-tile"]:has([data-focused])';

/** Where the chooser renders: Settings, or the welcome card's first-run step
 *  (inline at zero terminals, or in the Tutorial dialog). */
const IN_SETTINGS = '[data-testid="settings-popover"]';
const FIRST_RUN = '[data-testid="welcome-moment-choose-agents"]';

/** A profile row inside `scope`, by its reference. */
const row = (reference: string, scope = IN_SETTINGS) =>
  `${scope} [data-testid="agents-profile-row"][data-reference="${reference}"]`;

/** This machine's open host details, and the one line of its agents section
 *  that carries the state (the row holds its label too). */
const HOST_DETAILS = '[data-testid="host-diagnostics-popover"]';
const AGENTS_STATE = `${HOST_DETAILS} [data-testid="host-agents-state-text"]`;

/** The host tab strip's agents mark (scoped to the real strip — its hidden
 *  measuring twin renders one too, without the test id). The e2e kolu has one
 *  host, this machine. */
const HOST_AGENTS_MARK =
  '[data-testid="host-chip-row"] [data-testid="host-agents-mark"]';

/** The local machine's name on every agents surface — its hostname, as the host
 *  tab shows it (the e2e server runs on this host). */
const LOCAL_NAME = os.hostname();

/** A stack as a step spells it: references separated by spaces (no reference
 *  holds one). */
const stackOf = (text: string): string[] =>
  text.split(/\s+/).filter((r) => r !== "");

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

// ── The switch ─────────────────────────────────────────────────────────────

/** Whether the Settings switch is on, once it shows. */
async function switchOn(world: KoluWorld): Promise<boolean> {
  const sw = world.page.locator(`${IN_SETTINGS} [data-testid="agents-switch"]`);
  await sw.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  return (await sw.getAttribute("aria-checked")) === "true";
}

/** The switch reads `on`, polled. */
async function waitForSwitch(world: KoluWorld, on: boolean): Promise<void> {
  await world.page
    .locator(
      `${IN_SETTINGS} [data-testid="agents-switch"][aria-checked="${on}"]`,
    )
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

/** Flip the switch to `on`, if it is not already. */
async function setSwitch(world: KoluWorld, on: boolean): Promise<void> {
  if ((await switchOn(world)) !== on)
    await world.page.click(`${IN_SETTINGS} [data-testid="agents-switch"]`);
  await waitForSwitch(world, on);
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

/** The chips under the row name the agents the fixture's package carries —
 *  its listing's own titles, never a hand-typed copy. */
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

// ── Toasts ─────────────────────────────────────────────────────────────────

/** A toast whose title is EXACTLY `text`. Exact, so one wording never passes
 *  for a longer one that starts with it. */
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

// ── The profile list ───────────────────────────────────────────────────────

/** Settings' list, once it shows (agents on). */
async function settingsList(world: KoluWorld): Promise<void> {
  await world.page
    .locator(`${IN_SETTINGS} [data-testid="agents-profiles"]`)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

/** The references of the rows in `scope`, in the order they show, once they
 *  read `expected` (polled: a write comes back through the preferences cell). */
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
      .locator(`${IN_SETTINGS} [data-testid="agents-profiles-empty"]`)
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

/** The last row is the repository's note: last of the list, with a docs
 *  link, and none of a profile's buttons — it is not an entry of the setting. */
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

/** kolu-server has built none of them (it delivers nothing here), so each row
 *  says it is resolving — in the line's own words. */
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

async function juspayOffered(world: KoluWorld, offered: boolean) {
  await settingsList(world);
  await world.page
    .locator(`${IN_SETTINGS} [data-testid="agents-add-juspay"]`)
    .waitFor({
      state: offered ? "visible" : "detached",
      timeout: POLL_TIMEOUT,
    });
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

When("I add the Juspay profile", async function (this: KoluWorld) {
  await this.page.click(`${IN_SETTINGS} [data-testid="agents-add-juspay"]`);
  await this.waitForFrame();
});

/** Typed into the add field and Enter — the field takes any reference. */
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

// ── What padi holds and gives ──────────────────────────────────────────────

/** What kolu-server pushed to padi — the stored preference through its one
 *  fold, which is what an edit writes. */
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

/** padi's current value of an agent-distro cell, once `accept` holds. */
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

/** padi ITSELF ready with the floor and no profiles — the push is a hop
 *  (browser → kolu-server preference → padi cell), so the next create
 *  resolves against it. */
async function readyWithNoProfiles(): Promise<
  Extract<AgentDistroStatus, { kind: "ready" }>
> {
  const status = await padiValue<AgentDistroStatus>(
    "agentDistroStatus/get",
    (s) => s.kind === "ready" && s.profiles.length === 0,
    "the agents ready with no profiles",
  );
  if (status.kind !== "ready") throw new Error("not ready");
  return status;
}

Then("padi should give new terminals the agents with no profiles", async () => {
  await readyWithNoProfiles();
});

/** A stack this kolu-server delivers nothing for: padi has no set for it, and
 *  says so — new terminals get no agents. */
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

// ── This machine: its tab mark, its host details, the fleet line ───────────

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

/** Below `md` the host tabs are mounted but hidden — the mark is in the DOM
 *  and on no screen, which is exactly the width where the fleet line's name
 *  is the only way to that machine's details. */
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

/** The machine's name on Settings' fleet line opens that machine's details —
 *  at EVERY width, including ones where the host tabs are not mounted. */
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

/** The profiles row names the stack that serves — none — beside the short
 *  hash of the package padi says it serves. */
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
      new RegExp(escapeRegExp(agentBundleShortHash(status.bundle))),
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

/** The section itself says which machine it is about — its own `data-host`,
 *  not the popover's header (which names the host whether or not the agents
 *  section rendered at all). */
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

// ── The tile's pill, and what runs in the terminal ─────────────────────────

const PILL = `${FOCUSED_TILE} [data-testid="tile-agent-chip"]`;

/** No profiles and no repository profile: the pill names no profile, only the
 *  short hash of the package padi serves. */
Then(
  "the focused tile's agents chip should show only the build it serves",
  async function (this: KoluWorld) {
    const status = await readyWithNoProfiles();
    const pill = this.page.locator(
      `${PILL}[data-hash="${agentBundleShortHash(status.bundle)}"]`,
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

/** The marker is built at runtime and the typed command carries only
 *  `${AI_PROFILE-…}`, so the shell's echo cannot satisfy it. */
Then(
  "the terminal's AI_PROFILE should be unset",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait('echo "ai-profile=[${AI_PROFILE-un}set]"');
    await waitForBufferContains(this.page, `ai-profile=[${"un"}set]`);
  },
);

/** Runs the terminal's `claude` and waits for the fixture's own words. The
 *  marker is never typed (the command is just `claude`), so the shell's echo
 *  cannot satisfy it. */
Then(
  "the terminal's claude should be the fixture",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait("claude");
    await waitForBufferContains(this.page, FIXTURE_CLAUDE_SAYS);
  },
);

/** Runs `agent-distro` — the picker the package carries — and waits for its
 *  line. The marker is never typed, so the shell's echo cannot satisfy it. */
Then(
  "the terminal's agent-distro should be the fixture picker",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait("agent-distro");
    await waitForBufferContains(this.page, FIXTURE_PICKER_SAYS);
  },
);

/** Counts fixture dirs on the terminal's PATH that hold a `claude`. Built so the
 *  awaited marker (`fixture-agents=0`) never appears in the typed command. */
Then(
  "the terminal should have no fixture agents on its PATH",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait(
      `echo "fixture-agents=$(command -v claude | grep -c ${FIXTURE_MARK})"`,
    );
    await waitForBufferContains(this.page, "fixture-agents=0");
  },
);

// ── A stale terminal, restarted in place ───────────────────────────────────

/** The terminal id a scenario remembered, per world — to prove a restart kept
 *  the SAME tile rather than opening a new one. */
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

/** Stale, but nothing to restart into yet: the host has no set for the new
 *  stack, so the pill carries no Restart. */
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
    // ONE pill: stale, restartable, carrying its "↻ Restart" action.
    await this.page
      .locator(
        `${PILL}[data-stale][data-restart] [data-testid="tile-agent-restart"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click Restart on the focused tile", async function (this: KoluWorld) {
  // The whole pill is the restart.
  await this.page.click(`${PILL}[data-restart]`);
});

/** The restarted tile PAINTS its new shell without a reload: the focused tile's
 *  OWN xterm buffer (read in the page, not the server's screen) is non-empty and
 *  no longer holds the old shell's text — so a fresh snapshot reached this
 *  pane's xterm, rather than the pane sitting blank on a dead attach. */
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

// ── The first-run step: the welcome card asks until agents are on ──────────

const TURN_ON = `${FIRST_RUN} [data-testid="welcome-agents-turn-on"]`;

Then(
  "the welcome card's first row should ask which agents I want",
  async function (this: KoluWorld) {
    // Polled: until preferences and the listing arrive, the first row is Pin it.
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

/** The step's list starts empty — the agents as they ship — with Juspay's
 *  one-click entry under it and the repository row last. A reference of your
 *  own stays a Settings matter: no add field here. */
Then(
  "the first-run step should offer Juspay over an empty list",
  async function (this: KoluWorld) {
    for (const id of [
      "agents-profiles-empty",
      "agents-profile-repo",
      "agents-add-juspay",
    ])
      await this.page
        .locator(`${FIRST_RUN} [data-testid="${id}"]`)
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(
      await this.page
        .locator(`${FIRST_RUN} [data-testid="agents-profile-input"]`)
        .count(),
      0,
      "the welcome step must not offer the add field",
    );
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

/** Agents were switched off: the row shows, but the keyboard does not jump to
 *  it. The button focuses itself a microtask after it mounts, so wait past
 *  that. */
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

/** The done line for agents on with no profiles, in the fold's own words. */
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

/** No agents entry in the done line: there is none while agents are off. The
 *  header itself may be absent (nothing else done). */
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
    // Polled: the browser's status cell may trail the padi read before this.
    await this.page
      .locator(`[data-testid="welcome-dialog"] ${FIRST_RUN}`)
      .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
  },
);

/** Records, from the very first script on every later page load, whether the
 *  first-run step EVER mounts — so "it never showed" is a fact about the whole
 *  load, not about one instant after it. */
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
