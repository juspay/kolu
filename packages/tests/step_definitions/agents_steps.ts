/**
 * Agents come with kolu — Settings → Agents, and what the NEXT terminal gets.
 *
 * The server runs with a fixture agent-distro bake (`support/agentDistroFixture.ts`):
 * profiles `vanilla` and `juspay`, each with a stub `claude` that names its
 * profile. The suite resets Agents OFF before every scenario; these steps turn it
 * on, switch it, and read the result where a user would — the tile's chip and
 * what `claude` runs in a terminal.
 */

import assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import type { AgentDistroStatus } from "@kolu/padi-client/surface";
import { waitForPadiCell } from "../support/padiCellWait.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { waitForBufferContains } from "../support/buffer.ts";

/** The focused tile — the one a just-created terminal lands in. */
const FOCUSED_TILE = '[data-testid="canvas-tile"]:has([data-focused])';

/** Is the Agents control on a profile (not "Off")? Read off the segment the
 *  control marks pressed. */
async function agentsOn(world: KoluWorld): Promise<boolean> {
  const off = world.page.locator('[data-testid="agents-profile-off"]');
  await off.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  return (await off.getAttribute("aria-pressed")) !== "true";
}

Then(
  "the Agents section should offer the {string} and {string} profiles",
  async function (this: KoluWorld, a: string, b: string) {
    // ONE control: Off, then a segment per profile.
    for (const value of ["off", a, b]) {
      await this.page
        .locator(`[data-testid="agents-profile-${value}"]`)
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    }
    const popover = this.page.locator('[data-testid="settings-popover"]');
    // Off, the hint says what turning it on does; on, it lists what the
    // selected profile ships, from the listing (the fixture's `claude 0.0.0`).
    const expected = (await agentsOn(this))
      ? "claude 0.0.0"
      : "Pick a profile to put agent-distro's agents first";
    await popover
      .getByText(expected, { exact: false })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I turn Agents {word}", async function (this: KoluWorld, state: string) {
  assert.ok(state === "on" || state === "off", `on|off, got ${state}`);
  const want = state === "on";
  // "On" is the default profile, `vanilla`, unless a profile is already on.
  if ((await agentsOn(this)) !== want)
    await this.page.click(
      `[data-testid="agents-profile-${want ? "vanilla" : "off"}"]`,
    );
  await this.page.waitForFunction(
    (on) =>
      (document
        .querySelector('[data-testid="agents-profile-off"]')
        ?.getAttribute("aria-pressed") ===
        "true") ===
      !on,
    want,
    { timeout: POLL_TIMEOUT },
  );
});

Then(
  "a toast should say {string}",
  async function (this: KoluWorld, text: string) {
    await this.page
      .locator("[data-sonner-toaster] li")
      .filter({ hasText: text })
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Agents hint should say {string}",
  async function (this: KoluWorld, text: string) {
    await this.page
      .locator('[data-testid="settings-popover"]')
      .getByText(text, { exact: false })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** The host tab strip's agents mark (scoped to the real strip — its hidden
 *  measuring twin renders one too, without the test id). The e2e kolu has one
 *  host, this machine. */
const HOST_AGENTS_MARK =
  '[data-testid="host-chip-row"] [data-testid="host-agents-mark"]';

Then(
  "this machine's Agents status should say {string}",
  async function (this: KoluWorld, text: string) {
    // The first status line is this machine's.
    await this.page
      .locator(
        '[data-testid="agents-status-lines"] [data-testid="agents-status-text"]',
      )
      .first()
      .filter({ hasText: text })
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
    await this.page.click(`[data-testid="agents-profile-${profile}"]`);
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
    await waitForBufferContains(
      this.page,
      `agent-distro fixture: ${profile} claude`,
    );
  },
);

/** Counts fixture dirs on the terminal's PATH that hold a `claude`. Built so the
 *  awaited marker (`fixture-agents=0`) never appears in the typed command. */
Then(
  "the terminal should have no fixture agents on its PATH",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait(
      'echo "fixture-agents=$(command -v claude | grep -c kolu-e2e-agent-distro)"',
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
    await this.page
      .locator(`${FOCUSED_TILE} [data-testid="tile-agent-chip"][data-stale]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await this.page
      .locator(`${FOCUSED_TILE} [data-testid="tile-agent-restart"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I click Restart on the focused tile", async function (this: KoluWorld) {
  await this.page.click(`${FOCUSED_TILE} [data-testid="tile-agent-restart"]`);
});
