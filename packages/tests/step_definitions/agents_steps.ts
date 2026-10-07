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

Then(
  "the Agents section should offer the {string} and {string} profiles",
  async function (this: KoluWorld, a: string, b: string) {
    for (const name of [a, b]) {
      await this.page
        .locator(`[data-testid="agents-profile-${name}"]`)
        .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    }
    const popover = this.page.locator('[data-testid="settings-popover"]');
    // The Agents row's hint names where the agents come from…
    await popover
      .getByText("Provided by agent-distro", { exact: false })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    // …and the Agent profile row's hint lists what the selected profile ships,
    // from the listing (the fixture's harness is `claude 0.0.0`).
    await popover
      .getByText("claude 0.0.0", { exact: false })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I turn Agents {word}", async function (this: KoluWorld, state: string) {
  assert.ok(state === "on" || state === "off", `on|off, got ${state}`);
  const toggle = this.page.locator('[data-testid="agents-enabled-toggle"]');
  const isOn = (await toggle.getAttribute("data-enabled")) !== null;
  if (isOn !== (state === "on")) await toggle.click();
  await this.page.waitForFunction(
    (on) =>
      (document
        .querySelector('[data-testid="agents-enabled-toggle"]')
        ?.hasAttribute("data-enabled") ?? false) === on,
    state === "on",
    { timeout: POLL_TIMEOUT },
  );
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
