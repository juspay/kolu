/**
 * Agents come with kolu — Settings → Agents, and what the NEXT terminal gets.
 *
 * The server runs with a fixture agent-distro bake (`support/agentDistroFixture.ts`):
 * bundles `vanilla` and `juspay`, each with a stub `claude` that names its
 * bundle, and a stub `agent-distro --list --json` that resolves any reference
 * (one containing "nobody" fails, in upstream's words). The suite resets Agents
 * to NEVER CHOSEN (`null`, a fresh install) before every scenario; these steps
 * switch, choose a profile, and read the result where a user would — the
 * welcome card's first-run switch, Settings' switch and profile field, the
 * tile's chip and what runs in a terminal.
 *
 * The same switch renders in Settings and in the welcome card's step, so every
 * lookup is SCOPED to the one it means.
 */

import assert from "node:assert";
import os from "node:os";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { agentBundleShortHash } from "@kolu/agent-distro/bundle";
import type {
  AgentDistroReceipt,
  AgentDistroStatus,
} from "@kolu/agent-distro/schema";
import {
  AGENTS_NOT_CHOSEN,
  AGENTS_OFF_MEANS,
  AGENTS_UNRESOLVED_MEANS,
  agentToast,
  agentsChosenLabel,
  agentsResolvedLine,
  agentsStepHint,
  agentUpdateRunning,
  restartedLabel,
} from "@kolu/agent-distro/status";
import {
  FIXTURE_MARK,
  FIXTURE_PROFILES,
  FIXTURE_REFERENCE_PROFILE,
  FIXTURE_SKIP_REASON,
  fixtureClaudeSays,
  fixtureNextRun,
  fixturePickerSays,
  fixtureProfile,
  fixtureResetUpdates,
} from "../support/agentDistroFixture.ts";
import { waitForPadiCell } from "../support/padiCellWait.ts";
import { escapeRegExp } from "../support/regexp.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";

/** The focused tile — the one a just-created terminal lands in. */
const FOCUSED_TILE = '[data-testid="canvas-tile"]:has([data-focused])';

/** Where the Agents switch renders: Settings, or the welcome card's first-run
 *  step (inline at zero terminals, or in the Tutorial dialog). */
const IN_SETTINGS = '[data-testid="settings-popover"]';
const FIRST_RUN = '[data-testid="welcome-moment-choose-agents"]';

/** The Agents switch inside `scope`. */
const agentsSwitch = (scope = IN_SETTINGS) =>
  `${scope} [data-testid="agents-switch"]`;

/** Settings' profile field, and the line under it. */
const PROFILE_INPUT = `${IN_SETTINGS} [data-testid="agents-profile-input"]`;
const RESOLVED_LINE = `${IN_SETTINGS} [data-testid="agents-resolved"]`;

/** Whether the switch in `scope` is on, once it shows. */
async function switchOn(
  world: KoluWorld,
  scope = IN_SETTINGS,
): Promise<boolean> {
  const sw = world.page.locator(agentsSwitch(scope));
  await sw.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  return (await sw.getAttribute("aria-checked")) === "true";
}

/** The switch in `scope` reads `on`, polled. */
async function waitForSwitch(
  world: KoluWorld,
  on: boolean,
  scope = IN_SETTINGS,
): Promise<void> {
  await world.page
    .locator(`${agentsSwitch(scope)}[aria-checked="${on}"]`)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

/** Flip the switch in `scope` to `on`, if it is not already. */
async function setSwitch(
  world: KoluWorld,
  on: boolean,
  scope = IN_SETTINGS,
): Promise<void> {
  if ((await switchOn(world, scope)) !== on)
    await world.page.click(agentsSwitch(scope));
  await waitForSwitch(world, on, scope);
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

/** A toast whose title is EXACTLY `text` — always a string from
 *  `@kolu/agent-distro/status`, the very function the UI words it with. Exact,
 *  so one wording never passes for a longer one that starts with it. */
async function toastSays(world: KoluWorld, text: string): Promise<void> {
  await world.page
    .locator("[data-sonner-toaster] [data-title]")
    .filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) })
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

Then(
  "a toast should say new terminals get the {string} profile",
  async function (this: KoluWorld, profile: string) {
    await toastSays(this, agentToast.on(profile));
  },
);

Then("a toast should say agents are off", async function (this: KoluWorld) {
  await toastSays(this, agentToast.off);
});

Then(
  "a toast should say the terminal restarted with the {string} agents",
  async function (this: KoluWorld, profile: string) {
    // A plain shell restarted: nothing to resume.
    await toastSays(
      this,
      restartedLabel({ agentProfile: profile, resumed: false }),
    );
  },
);

Then("the Agents hint should explain Off", async function (this: KoluWorld) {
  await this.page
    .locator('[data-testid="settings-popover"]')
    .getByText(AGENTS_OFF_MEANS, { exact: false })
    .first()
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

/** The host tab strip's agents mark (scoped to the real strip — its hidden
 *  measuring twin renders one too, without the test id). The e2e kolu has one
 *  host, this machine. */
const HOST_AGENTS_MARK =
  '[data-testid="host-chip-row"] [data-testid="host-agents-mark"]';

Then(
  "this machine's Agents status should be ready",
  async function (this: KoluWorld) {
    // The first status line is this machine's; its bar says the state.
    assert.ok(await switchOn(this), "Agents are off; there is nothing ready");
    await this.page
      .locator(
        '[data-testid="agents-status-lines"] [data-testid="agents-status-text"][data-bar="ok"]',
      )
      .first()
      .filter({ hasText: /^ready · / })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

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

When("I click the host tab's agents mark", async function (this: KoluWorld) {
  await this.page.click(HOST_AGENTS_MARK);
});

/** Agents on, then `profile` typed into the profile field and Enter. */
When(
  "I choose the {string} Agents profile",
  async function (this: KoluWorld, profile: string) {
    await setSwitch(this, true);
    const input = this.page.locator(PROFILE_INPUT);
    await input.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await input.fill(profile);
    await input.press("Enter");
    await this.waitForFrame();
  },
);

Then(
  "the profile field should hold {string}",
  async function (this: KoluWorld, profile: string) {
    await this.page.waitForFunction(
      ([sel, want]) =>
        (document.querySelector(sel as string) as HTMLInputElement | null)
          ?.value === want,
      [PROFILE_INPUT, profile] as const,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then("the profile field should not show", async function (this: KoluWorld) {
  await this.page
    .locator(PROFILE_INPUT)
    .waitFor({ state: "detached", timeout: POLL_TIMEOUT });
});

/** The resolved line names `name` as agent-distro answered — worded by the
 *  same fold the UI uses, for the profile the field holds. */
async function resolvesTo(
  world: KoluWorld,
  answer: { readonly name: string; readonly description: string },
): Promise<void> {
  const profile = await world.page.locator(PROFILE_INPUT).inputValue();
  const line = agentsResolvedLine(
    { enabled: true, profile },
    { kind: "resolved", profile, ...answer },
  );
  assert.ok(line?.kind === "resolved");
  await world.page
    .locator(`${RESOLVED_LINE}[data-kind="resolved"]`)
    .filter({ hasText: new RegExp(`^${escapeRegExp(line.text)}$`) })
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

Then(
  "the profile field should say it resolves to the reference's profile",
  async function (this: KoluWorld) {
    await resolvesTo(this, FIXTURE_REFERENCE_PROFILE);
  },
);

Then(
  "the profile field should say it resolves to {string}",
  async function (this: KoluWorld, name: string) {
    await resolvesTo(this, fixtureProfile(name));
  },
);

/** The fixture fails as upstream does for a reference it cannot fetch; the
 *  line quotes it (agent-distro's prefix and the variable's label dropped),
 *  then says what that means for new terminals. */
Then(
  "the profile field should say {string} does not resolve",
  async function (this: KoluWorld, profile: string) {
    const line = this.page.locator(`${RESOLVED_LINE}[data-kind="failed"]`);
    await line
      .filter({ hasText: `cannot fetch ${profile}: unable to download` })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await line
      .getByText(AGENTS_UNRESOLVED_MEANS, { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** The pill names what agent-distro answered for THIS terminal: the fixture
 *  reports {@link FIXTURE_REFERENCE_PROFILE} for any `AI_PROFILE`, from the
 *  variable. */
Then(
  "the focused tile's agents chip should name the profile in effect from the reference",
  async function (this: KoluWorld) {
    await this.page
      .locator(
        `${FOCUSED_TILE} [data-testid="tile-agent-chip"][data-profile="${FIXTURE_REFERENCE_PROFILE.name}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** The marker carries the VALUE; the typed command carries only `$AI_PROFILE`,
 *  so the shell's echo cannot satisfy it. */
Then(
  "the terminal's AI_PROFILE should be {string}",
  async function (this: KoluWorld, reference: string) {
    await this.terminalRunAndWait('echo "ai-profile=[$AI_PROFILE]"');
    await waitForBufferContains(this.page, `ai-profile=[${reference}]`);
  },
);

/** The push is a hop (browser → kolu-server preference → padi cell): wait until
 *  padi ITSELF reports the profile ready, so the next create resolves against it. */
Then(
  "padi should give new terminals the {string} agents",
  async function (this: KoluWorld, profile: string) {
    await waitForPadiCell({
      memberVerb: "agentDistroStatus/get",
      accept: (s) => {
        const status = s as AgentDistroStatus;
        return status.kind === "ready" && status.profile === profile;
      },
      what: `the ${profile} agents ready`,
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
  "the focused tile should show the {string} agents chip",
  async function (this: KoluWorld, profile: string) {
    await this.page
      .locator(
        `${FOCUSED_TILE} [data-testid="tile-agent-chip"][data-profile="${profile}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When(
  "I click the focused tile's agents chip",
  async function (this: KoluWorld) {
    await this.page.click(`${FOCUSED_TILE} [data-testid="tile-agent-chip"]`);
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
    assert.strictEqual(
      await this.page
        .locator(`${FOCUSED_TILE} [data-testid="tile-agent-chip"]`)
        .count(),
      0,
      "a terminal spawned with Agents off must carry no chip",
    );
  },
);

/** Runs the terminal's `claude` and waits for the fixture's own words. The
 *  marker is never typed (the command is just `claude`), so the shell's echo
 *  cannot satisfy it. */
Then(
  "the terminal's claude should be the {string} fixture",
  async function (this: KoluWorld, profile: string) {
    await this.terminalRunAndWait("claude");
    await waitForBufferContains(this.page, fixtureClaudeSays(profile));
  },
);

/** Runs `agent-distro` — the picker the chosen profile's bundle carries — in
 *  the terminal and waits for its line. The marker is never typed, so the
 *  shell's echo cannot satisfy it. */
Then(
  "the terminal's agent-distro should name the {string} profile",
  async function (this: KoluWorld, profile: string) {
    await this.terminalRunAndWait("agent-distro");
    await waitForBufferContains(this.page, fixturePickerSays(profile));
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

Then(
  "the focused tile's agents chip should be stale with a Restart button",
  async function (this: KoluWorld) {
    // ONE pill: stale, restartable, carrying its "↻ Restart" action.
    await this.page
      .locator(
        `${FOCUSED_TILE} [data-testid="tile-agent-chip"][data-stale][data-restart] [data-testid="tile-agent-restart"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click Restart on the focused tile", async function (this: KoluWorld) {
  // The whole pill is the restart.
  await this.page.click(
    `${FOCUSED_TILE} [data-testid="tile-agent-chip"][data-restart]`,
  );
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

// ── The first-run step: the welcome card asks until agents are on ──────────────

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

/** The fixture's listing, as the step's words are composed from it. */
const FIXTURE_LISTING = {
  kind: "available",
  profiles: FIXTURE_PROFILES.map(fixtureProfile),
} as const;

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
  "the first-run agents switch should be off",
  async function (this: KoluWorld) {
    await waitForSwitch(this, false, FIRST_RUN);
  },
);

When("I turn on the first-run agents switch", async function (this: KoluWorld) {
  await this.page.click(agentsSwitch(FIRST_RUN));
  await this.waitForFrame();
});

Then(
  "keyboard focus should be on the first-run agents switch",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      (sel) => document.activeElement === document.querySelector(sel),
      agentsSwitch(FIRST_RUN),
      { timeout: POLL_TIMEOUT },
    );
  },
);

/** Agents were switched off: the row shows, but the keyboard does not jump to
 *  it. The switch focuses itself a microtask after it mounts, so wait past
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
  "the Agents control in Settings should have nothing chosen",
  async function (this: KoluWorld) {
    await waitForSwitch(this, false);
    await this.page
      .locator(IN_SETTINGS)
      .getByText(AGENTS_NOT_CHOSEN, { exact: false })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
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
  "the welcome card's done line should say agents are {string}",
  async function (this: KoluWorld, value: string) {
    const label = agentsChosenLabel(
      { enabled: true, profile: value },
      FIXTURE_LISTING,
    );
    assert.ok(label, "a chosen profile has a done line");
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

// ── Kept up to date: updates, Check now, History ──────────────────────────────

/** The local machine's name on every agents surface — its hostname, as the host
 *  tab shows it (the e2e server runs on this host). */
const LOCAL_NAME = os.hostname();

/** This machine's line under the Agents row (the first). */
const LOCAL_LINE = `${IN_SETTINGS} [data-testid="agents-status-lines"] [data-testid="agents-status-text"]`;

/** Any scenario that turned agents on ran the fixture's updater (turning them
 *  on asks once whether an update is due), and an update scenario lands
 *  bundles and history: undo it after EVERY scenario, so the next one on this
 *  worker meets the floor and no `last-success`. First wait until padi has no
 *  run in flight for ANY profile — the receipt's running set, read through
 *  `agentUpdateRunning`, not the status (which follows only the selected
 *  profile, so a scenario that switched profiles and turned agents off would
 *  pass with a run still going). Deleting a run's state under it
 *  fails that run, and the next scenario's ask would meet it still going. */
After(async () => {
  await waitForPadiCell({
    memberVerb: "agentDistroReceipt/get",
    accept: (v) => !agentUpdateRunning([v as AgentDistroReceipt]),
    what: "no agent-distro run in flight, for any profile",
    timeoutMs: POLL_TIMEOUT,
  });
  fixtureResetUpdates();
});

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

Given(
  "the next {string} agents update finds a newer set",
  (profile: string) => {
    fixtureNextRun(profile, "update");
  },
);

Given(
  "the next {string} agents update finds the newer set not ready to download",
  (profile: string) => {
    fixtureNextRun(profile, "skip");
  },
);

When("I click Check now", async function (this: KoluWorld) {
  await this.page.click(`${IN_SETTINGS} [data-testid="agents-check-now"]`);
});

Then(
  "this machine's Agents line should show an update {word}",
  async function (this: KoluWorld, phase: string) {
    assert.ok(phase === "checking" || phase === "downloading", phase);
    await this.page
      .locator(`${LOCAL_LINE}[data-update="${phase}"]`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // The tab's mark says the same phase, from the same fold.
    await this.page
      .locator(
        `${HOST_AGENTS_MARK}[data-state="ready"][data-update="${phase}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // The button is busy: its only machine is running an update, so there
    // is no host it could ask (`agentCheckNowBusy`).
    await this.page
      .locator(`${IN_SETTINGS} [data-testid="agents-check-now"][data-busy]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** This machine's last update run as padi's receipt has it, when a step
 *  remembered it — so a later step can tell a NEW run from the one before. */
let rememberedRunAt: number | undefined;

When(
  "I remember this machine's last update run",
  async function (this: KoluWorld) {
    const receipt = await padiValue<AgentDistroReceipt>(
      "agentDistroReceipt/get",
      (r) => r.lastRun !== undefined,
      "a receipt with a last run",
    );
    rememberedRunAt = receipt.lastRun?.at;
  },
);

Then(
  "this machine's last update run should be newer than the one I remembered",
  async function (this: KoluWorld) {
    const before = rememberedRunAt;
    assert.ok(before !== undefined, "no run remembered");
    await padiValue<AgentDistroReceipt>(
      "agentDistroReceipt/get",
      (r) => (r.lastRun?.at ?? 0) > before,
      "a receipt whose last run is newer than the remembered one",
    );
  },
);

Then(
  "this machine's Agents line should say the last run {word}",
  async function (this: KoluWorld, outcome: string) {
    try {
      await this.page
        .locator(`${LOCAL_LINE}[data-last-run="${outcome}"]`)
        .first()
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    } catch (err) {
      // Say what padi's receipt holds instead — the updater's own words.
      const receipt = await padiValue<AgentDistroReceipt>(
        "agentDistroReceipt/get",
        () => true,
        "the receipt",
      );
      throw new Error(
        `the line never said the last run ${outcome}; padi's receipt: ${JSON.stringify(receipt)}`,
        { cause: err },
      );
    }
  },
);

/** The words of this machine's last `updated` run, as padi's receipt has them. */
async function updatedWords(): Promise<string> {
  const receipt = await padiValue<AgentDistroReceipt>(
    "agentDistroReceipt/get",
    (r) => r.lastRun?.outcome === "updated",
    "a receipt with an updated run",
  );
  return receipt.lastRun?.words ?? "";
}

Then(
  "a toast should say what the update changed on this machine",
  async function (this: KoluWorld) {
    const words = agentToast.updated(LOCAL_NAME, await updatedWords());
    const toast = this.page
      .locator("[data-sonner-toaster] [data-sonner-toast]")
      .filter({
        has: this.page.locator("[data-title]", {
          hasText: new RegExp(`^${escapeRegExp(words.title)}$`),
        }),
      })
      .first();
    await toast.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const description = await toast.locator("[data-description]").innerText();
    assert.strictEqual(description.trim(), words.description);
  },
);

Then(
  "no toast should say an update landed on this machine",
  async function (this: KoluWorld) {
    // The run has settled (the line says so) before this is asked.
    const title = agentToast.updated(LOCAL_NAME, "").title;
    assert.strictEqual(
      await this.page
        .locator("[data-sonner-toaster] [data-title]")
        .filter({ hasText: new RegExp(`^${escapeRegExp(title)}$`) })
        .count(),
      0,
      "an update toast showed",
    );
  },
);

Then(
  "the Agents History should list the {word} event",
  async function (this: KoluWorld, kind: string) {
    const history = this.page.locator(
      `${IN_SETTINGS} [data-testid="agents-history"]`,
    );
    if ((await history.getAttribute("open")) === null)
      await history.locator("summary").click();
    await history
      .locator(`[data-testid="agents-history-row"][data-kind="${kind}"]`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // The row quotes padi's own event words.
    const receipt = await padiValue<AgentDistroReceipt>(
      "agentDistroReceipt/get",
      (r) => r.events.some((e) => e.kind === kind),
      `a receipt with a ${kind} event`,
    );
    const event = receipt.events.find((e) => e.kind === kind);
    if (kind === "skipped")
      assert.strictEqual(event?.words, FIXTURE_SKIP_REASON);
    const text = await history
      .locator(`[data-testid="agents-history-row"][data-kind="${kind}"]`)
      .first()
      .innerText();
    assert.ok(
      text.endsWith(event?.words ?? "-"),
      `history row ${JSON.stringify(text)} does not quote ${JSON.stringify(event?.words)}`,
    );
  },
);

Then(
  "the focused tile's agents chip should carry the bundle new terminals get now",
  async function (this: KoluWorld) {
    const status = await padiValue<AgentDistroStatus>(
      "agentDistroStatus/get",
      (s) => s.kind === "ready" && s.update === undefined,
      "agents ready",
    );
    if (status.kind !== "ready") throw new Error("not ready");
    const hash = agentBundleShortHash(status.bundle);
    // Not the floor's: an update landed.
    assert.notStrictEqual(
      hash,
      agentBundleShortHash(`/${status.profile}`),
      "new terminals still get the floor",
    );
    await this.page
      .locator(
        `${FOCUSED_TILE} [data-testid="tile-agent-chip"][data-hash="${hash}"]:not([data-stale])`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Agents line and History name this machine by its hostname",
  async function (this: KoluWorld) {
    // The `data-host` the cell carries — its text also holds the logo's SVG.
    await this.page
      .locator(
        `${IN_SETTINGS} [data-testid="agents-status-host"][data-host="${LOCAL_NAME}"]`,
      )
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const history = this.page.locator(
      `${IN_SETTINGS} [data-testid="agents-history"]`,
    );
    if ((await history.getAttribute("open")) === null)
      await history.locator("summary").click();
    await history
      .locator(`[data-testid="agents-history-host"][data-host="${LOCAL_NAME}"]`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
