/**
 * A HOST WHOSE AGENTS ARE OLDER THAN THIS KOLU — the skew a real machine is in
 * whenever the package kolu delivered it predates a command kolu's contract
 * calls (`agent-distro --models <harness>`). The arrangement takes the
 * `answers` file away from the suite's floor package
 * (`support/agentDistroFixture.ts`), which is exactly what such a package has
 * not got — so padi refuses the model call without ever running the picker,
 * and kolu-server refuses the work before any setup form exists.
 *
 * Order matters and is the whole arrangement: the floor is aged out BEFORE
 * Agents is turned on, because padi reads the package when it settles the
 * status it publishes. The worker's floor is shared, so it is put back after
 * every scenario.
 *
 * Every word these steps expect comes from `@kolu/agent-distro`'s own
 * functions — the ones kolu-server words the refusal with.
 */

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

/** The conductor's transcript, and the sentence kolu refuses with — named for
 *  THIS machine, which every agents surface in the suite calls by its
 *  hostname. */
const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const TOO_OLD_HERE = agentsTooOldWords(os.hostname());

Given("this machine's agents are older than this kolu needs", () => {
  ageOutFixturePackage();
});

/** A HOST THAT CANNOT LIST ITS MODELS JUST NOW — the floor's list command
 *  fails, as one whose gateway key lives only in a person's shell did, while
 *  `--launch` still answers. Put back by the same After hook. */
Given("this machine cannot list its models", () => {
  failFixtureModelList();
});

/** A HOST THAT LISTS DOZENS OF MODELS, as a gateway does: `model-01` … and
 *  `model` among them, sorted the way a listing is. Put back by the same
 *  After hook. */
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
  // Unconditional and idempotent: the floor is shared by every scenario this
  // worker runs, and a scenario that failed half-way through must not leave
  // the next one on an aged-out package.
  restoreFixturePackage();
});

/** THE ARRANGEMENT, PROVED — padi itself serving a package it may not ask for
 *  models. Without this a refusal below could be any other `agents-not-ready`
 *  (off, undelivered, still settling), and the scenario would pass for the
 *  wrong reason. */
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

/** THE WHOLE SENTENCE, where the person reads it: the Conductor said what
 *  kolu would not do and why, so the skew is a named state rather than a
 *  picker's error nobody can act on. */
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

/** AND NOTHING WAS PUT TO THEM. The refusal comes before the work exists, so
 *  there is no card, no setup question and nothing to press. */
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
