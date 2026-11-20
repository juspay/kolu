import assert from "node:assert";
import os from "node:os";
import { After, Given, Then } from "@cucumber/cucumber";
import { missingPackageCalls } from "@kolu/agent-distro/models";
import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import { agentsTooOldWords } from "@kolu/agent-distro/status";
import {
  ageOutFixturePackage,
  failFixtureModelList,
  listFixtureModels,
  restoreFixturePackage,
} from "../support/agentDistroFixture.ts";
import { waitForPadiCell } from "../support/padiCellWait.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const TOO_OLD_HERE = agentsTooOldWords(os.hostname());

Given("this machine's agents are older than this kolu needs", () => {
  ageOutFixturePackage();
});

Given("this machine cannot list its models", () => {
  failFixtureModelList();
});

Given(
  "this machine lists {int} models, {string} among them",
  (count: number, model: string) => {
    const ids = Array.from(
      { length: count - 1 },
      (_, n) => `model-${String(n + 1).padStart(2, "0")}`,
    );
    listFixtureModels([...ids, model].sort());
  },
);

After(() => {
  restoreFixturePackage();
});

Then(
  "padi should say this machine's agents cannot be asked for models",
  async () => {
    await waitForPadiCell({
      memberVerb: "agentDistroStatus/get",
      accept: (value) => {
        const status = value as AgentDistroStatus;
        return (
          status.kind === "ready" &&
          missingPackageCalls(status.answers).length > 0
        );
      },
      what: "the agents ready but older than this kolu needs",
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the conductor should say this machine's agents are older than this kolu needs",
  async function (this: KoluWorld) {
    const transcript = this.page.locator(TRANSCRIPT);
    await transcript.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await pollFor({
      observe: async () =>
        (await transcript.innerText()).replace(/\s+/g, " ").trim(),
      isDone: (said) => said.includes(TOO_OLD_HERE),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (said, ms) =>
        new Error(
          `the conductor never said ${JSON.stringify(TOO_OLD_HERE)} in ${ms}ms; the transcript reads ${JSON.stringify(said ?? "(nothing)")}`,
        ),
    });
  },
);

Then("no setup question should be put to me", async function (this: KoluWorld) {
  for (const selector of [
    '[data-testid="work-card"]',
    '[data-testid="work-question"]',
    '[data-testid="conductor-ask-option"]',
  ])
    assert.equal(
      await this.page.locator(selector).count(),
      0,
      `${selector} is on screen, so something was put to the human`,
    );
});
