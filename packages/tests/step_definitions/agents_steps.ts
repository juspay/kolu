/**
 * Agents come with kolu — Settings → Agents, and what the NEXT terminal gets.
 *
 * The server runs with a fixture agent-distro bake (`support/agentDistroFixture.ts`):
 * profiles `vanilla` and `juspay`, each with a stub `claude` that names its
 * profile. The suite resets Agents to NEVER CHOSEN (`null`, a fresh install)
 * before every scenario; these steps choose, switch, and read the result where a
 * user would — the welcome card's first-run step, Settings, the tile's chip and
 * what `claude` runs in a terminal.
 *
 * The same Agents control renders in Settings and in the welcome card's step, so
 * every segment lookup is SCOPED to the one it means.
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
  AGENTS_OFF,
  AGENTS_OFF_MEANS,
  AGENTS_SEGMENT_TESTID,
  agentToast,
  agentsChosenLabel,
  agentsStepHint,
  agentUpdateRunning,
  harnessLine,
  restartedLabel,
} from "@kolu/agent-distro/status";
import {
  FIXTURE_DEFAULT_PROFILE,
  FIXTURE_MARK,
  FIXTURE_PROFILES,
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

/** Where the Agents control renders: Settings, or the welcome card's first-run
 *  step (inline at zero terminals, or in the Tutorial dialog). */
const IN_SETTINGS = '[data-testid="settings-popover"]';
const FIRST_RUN = '[data-testid="welcome-moment-choose-agents"]';

/** The Agents control's segment for `value` (a profile, or `AGENTS_OFF`), inside
 *  `scope`. */
const segment = (value: string, scope = IN_SETTINGS) =>
  `${scope} [data-testid="${AGENTS_SEGMENT_TESTID}-${value}"]`;

/** Every segment the fixture's control offers: Off, then each profile. */
const SEGMENTS = [AGENTS_OFF, ...FIXTURE_PROFILES];

/** The segment the Agents control in `scope` shows pressed — `undefined` while
 *  nothing is chosen (no segment pressed). */
async function pressedSegment(
  world: KoluWorld,
  scope = IN_SETTINGS,
): Promise<string | undefined> {
  await world.page
    .locator(segment(AGENTS_OFF, scope))
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  const pressed: string[] = [];
  for (const value of SEGMENTS)
    if (
      (await world.page
        .locator(segment(value, scope))
        .getAttribute("aria-pressed")) === "true"
    )
      pressed.push(value);
  assert.ok(pressed.length <= 1, `several segments pressed: ${pressed}`);
  return pressed[0];
}

/** The profile the Agents control has selected, or `undefined` when agents are
 *  off or nothing is chosen. */
async function selectedProfile(world: KoluWorld): Promise<string | undefined> {
  const pressed = await pressedSegment(world);
  return pressed === AGENTS_OFF ? undefined : pressed;
}

Then(
  "the Agents section should offer the {string} and {string} profiles",
  async function (this: KoluWorld, a: string, b: string) {
    // ONE control: Off, then a segment per profile.
    for (const value of [AGENTS_OFF, a, b]) {
      await this.page
        .locator(segment(value))
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    }
    const popover = this.page.locator('[data-testid="settings-popover"]');
    // Off, the hint says what Off means; on, it lists what the SELECTED profile
    // ships — both worded by the same functions the UI uses.
    const selected = await selectedProfile(this);
    const expected =
      selected === undefined
        ? AGENTS_OFF_MEANS
        : harnessLine(fixtureProfile(selected));
    await popover
      .getByText(expected, { exact: false })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I turn Agents {word}", async function (this: KoluWorld, state: string) {
  assert.ok(state === "on" || state === "off", `on|off, got ${state}`);
  const want = state === "on";
  // "On" is the listing's default profile, unless a profile is already on; from
  // never chosen, either way is a click.
  const pressed = await pressedSegment(this);
  const isOn = pressed !== undefined && pressed !== AGENTS_OFF;
  if (want ? !isOn : pressed !== AGENTS_OFF)
    await this.page.click(segment(want ? FIXTURE_DEFAULT_PROFILE : AGENTS_OFF));
  await this.page.waitForFunction(
    ([on, offSel]) =>
      (document
        .querySelector(offSel as string)
        ?.getAttribute("aria-pressed") ===
        "true") ===
      !on,
    [want, segment(AGENTS_OFF)] as const,
    { timeout: POLL_TIMEOUT },
  );
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
  "a toast should say new terminals get the {string} agents",
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
    // The first status line is this machine's; its bar says the state, and its
    // words name the profile the control has selected.
    const profile = await selectedProfile(this);
    assert.ok(profile, "Agents are off; there is no profile to be ready");
    await this.page
      .locator(
        '[data-testid="agents-status-lines"] [data-testid="agents-status-text"][data-bar="ok"]',
      )
      .first()
      .filter({ hasText: new RegExp(`^ready · ${escapeRegExp(profile)} `) })
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

When(
  "I choose the {string} Agents profile",
  async function (this: KoluWorld, profile: string) {
    await this.page.click(segment(profile));
    await this.waitForFrame();
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
  "the first-run step should say what {string} means",
  async function (this: KoluWorld, value: string) {
    const hint = agentsStepHint({
      listing: FIXTURE_LISTING,
      segment: value === "off" ? AGENTS_OFF : value,
    });
    assert.ok(hint?.choice, `no words for ${value}`);
    await this.page
      .locator(`${FIRST_RUN} [data-testid="welcome-agents-choice"]`)
      .filter({ hasText: new RegExp(`^${escapeRegExp(hint.choice)}$`) })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator(FIRST_RUN)
      .getByText(hint.lead, { exact: true })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the first-run agents choice should have nothing chosen",
  async function (this: KoluWorld) {
    assert.strictEqual(await pressedSegment(this, FIRST_RUN), undefined);
  },
);

Then(
  "the first-run agents choice should show {string} chosen",
  async function (this: KoluWorld, value: string) {
    const want = value === "off" ? AGENTS_OFF : value;
    await this.page
      .locator(`${segment(want, FIRST_RUN)}[aria-pressed="true"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(await pressedSegment(this, FIRST_RUN), want);
  },
);

/** The one tab stop of the first-run control is `value` — where Tab lands —
 *  whatever is pressed. */
Then(
  "the first-run step should rest the keyboard on {string}",
  async function (this: KoluWorld, value: string) {
    const want = value === "off" ? AGENTS_OFF : value;
    await this.page
      .locator(`${segment(want, FIRST_RUN)}[tabindex="0"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    for (const v of SEGMENTS)
      assert.strictEqual(
        await this.page.locator(segment(v, FIRST_RUN)).getAttribute("tabindex"),
        v === want ? "0" : "-1",
        `tabindex of the ${v} segment`,
      );
  },
);

/** Off was picked: the row shows, but the keyboard does not jump to it. The
 *  control focuses itself a frame after it mounts, so wait past that. */
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
    assert.strictEqual(await pressedSegment(this), undefined);
    await this.page
      .locator(IN_SETTINGS)
      .getByText(AGENTS_NOT_CHOSEN, { exact: false })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Agents control in Settings should show {string} chosen",
  async function (this: KoluWorld, value: string) {
    // `off` names the Off segment; anything else is a profile.
    const want = value === "off" ? AGENTS_OFF : value;
    await this.page
      .locator(`${segment(want)}[aria-pressed="true"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(await pressedSegment(this), want);
  },
);

/** Keyboard focus is on the `value` segment of the control in `scope`, and it
 *  is the one tab stop there. */
async function assertFocusedSegment(
  world: KoluWorld,
  value: string,
  scope: string,
): Promise<void> {
  const want = value === "off" ? AGENTS_OFF : value;
  const sel = segment(want, scope);
  await world.page.waitForFunction(
    (s) => document.activeElement === document.querySelector(s),
    sel,
    { timeout: POLL_TIMEOUT },
  );
  // One tab stop: only the focused segment is in the tab order.
  for (const v of SEGMENTS)
    assert.strictEqual(
      await world.page.locator(segment(v, scope)).getAttribute("tabindex"),
      v === want ? "0" : "-1",
      `tabindex of the ${v} segment`,
    );
}

Then(
  "keyboard focus should be on the first-run {string} segment",
  async function (this: KoluWorld, value: string) {
    await assertFocusedSegment(this, value, FIRST_RUN);
  },
);

Then(
  "keyboard focus should be on the Settings {string} Agents segment",
  async function (this: KoluWorld, value: string) {
    await assertFocusedSegment(this, value, IN_SETTINGS);
  },
);

/** A real Tab into the Agents control in `scope`: focus a throwaway stop placed
 *  just before the control, then press Tab — the browser lands on whatever the
 *  control puts in the tab order. */
async function tabInto(world: KoluWorld, scope: string): Promise<void> {
  const group = `${scope} [data-testid="${AGENTS_SEGMENT_TESTID}-toggle"]`;
  await world.page
    .locator(group)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await world.page.evaluate((sel) => {
    const control = document.querySelector(sel);
    if (control === null) throw new Error(`no ${sel}`);
    const before = document.createElement("button");
    before.dataset.testid = "tab-into-sentinel";
    control.before(before);
    before.focus();
    before.addEventListener("blur", () => before.remove(), { once: true });
  }, group);
  await world.page.keyboard.press("Tab");
}

When(
  "I tab into the first-run agents choice",
  async function (this: KoluWorld) {
    await tabInto(this, FIRST_RUN);
  },
);

When(
  "I tab into the Agents control in Settings",
  async function (this: KoluWorld) {
    await tabInto(this, IN_SETTINGS);
  },
);

When(
  "I choose the {string} first-run agents",
  async function (this: KoluWorld, value: string) {
    await this.page.click(
      segment(value === "off" ? AGENTS_OFF : value, FIRST_RUN),
    );
    await this.waitForFrame();
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
