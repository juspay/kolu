/**
 * Plan detection & inline commenting — step definitions.
 *
 * Creates temp project directories with .claude/plans/ subdirectories
 * containing mock plan files. The terminal CDs into the project to
 * trigger the plans provider.
 */

import { When, Then, Given, After } from "@cucumber/cucumber";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as assert from "node:assert";
import { KoluWorld } from "../support/world.ts";
import { pollUntil } from "../support/poll.ts";

const SIMPLE_PLAN = `# My Plan

This is a simple test plan.
`;

const STRUCTURED_PLAN = `# Plan Overview

High-level description of the plan.

## Step 1: Analyze the codebase

Review existing code patterns and identify areas for improvement.

## Step 2: Implement changes

Make the necessary modifications following the identified patterns.

## Step 3: Verify

Run tests and confirm everything works correctly.
`;

/** Track temp directories for cleanup. */
let projectDir: string | null = null;

function cleanup() {
  if (projectDir && fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true });
    projectDir = null;
  }
}

After(function () {
  cleanup();
});

function createProjectWithPlan(planName: string, content: string): string {
  cleanup();
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-plan-test-"));
  const plansDir = path.join(projectDir, ".claude", "plans");
  fs.mkdirSync(plansDir, { recursive: true });
  fs.writeFileSync(path.join(plansDir, `${planName}.md`), content);
  return projectDir;
}

Given(
  "a project directory with a plan file {string}",
  function (this: KoluWorld, planName: string) {
    createProjectWithPlan(planName, SIMPLE_PLAN);
  },
);

Given(
  "a project directory with a structured plan file {string}",
  function (this: KoluWorld, planName: string) {
    createProjectWithPlan(planName, STRUCTURED_PLAN);
  },
);

When("I cd into the project directory", async function (this: KoluWorld) {
  if (!projectDir) throw new Error("No project directory created");
  await this.terminalRun(`cd ${projectDir}`);
  // Wait for CWD change to propagate (OSC 7 from shell)
  await this.page.waitForTimeout(2000);
});

When(
  "a new plan file {string} is added to the project",
  async function (this: KoluWorld, planName: string) {
    if (!projectDir) throw new Error("No project directory created");
    const plansDir = path.join(projectDir, ".claude", "plans");
    fs.writeFileSync(path.join(plansDir, `${planName}.md`), SIMPLE_PLAN);
  },
);

Then(
  "the sidebar should show a plan entry {string}",
  async function (this: KoluWorld, planName: string) {
    const entry = this.page.locator(
      `[data-testid="plan-entry"]:has-text("${planName}")`,
    );
    await pollUntil(
      this.page,
      async () => {
        try {
          return await entry.count();
        } catch {
          return 0;
        }
      },
      (count) => count > 0,
      { attempts: 30, intervalMs: 500 },
    );
    const count = await entry.count();
    assert.ok(count > 0, `Expected plan entry "${planName}" in sidebar`);
  },
);

When(
  "I click the plan entry {string}",
  async function (this: KoluWorld, planName: string) {
    const entry = this.page.locator(
      `[data-testid="plan-entry"]:has-text("${planName}")`,
    );
    await entry.click();
    // Wait for plan pane to render
    await this.page.waitForTimeout(500);
  },
);

Then("the plan pane should be visible", async function (this: KoluWorld) {
  const pane = this.page.locator('[data-testid="plan-pane"]');
  await pane.waitFor({ state: "visible", timeout: 5000 });
});

Then("the plan pane should not be visible", async function (this: KoluWorld) {
  const pane = this.page.locator('[data-testid="plan-pane"]');
  await pollUntil(
    this.page,
    async () => {
      try {
        return await pane.count();
      } catch {
        return 0;
      }
    },
    (count) => count === 0,
    { attempts: 10, intervalMs: 300 },
  );
});

Then(
  "the plan pane should show the plan name {string}",
  async function (this: KoluWorld, planName: string) {
    const pane = this.page.locator('[data-testid="plan-pane"]');
    const text = await pane.textContent();
    assert.ok(
      text?.includes(planName),
      `Expected plan pane to show "${planName}", got: ${text}`,
    );
  },
);

Then(
  "the plan pane should show at least {int} sections",
  async function (this: KoluWorld, minSections: number) {
    const sections = this.page.locator('[data-testid="plan-section"]');
    await pollUntil(
      this.page,
      async () => {
        try {
          return await sections.count();
        } catch {
          return 0;
        }
      },
      (count) => count >= minSections,
      { attempts: 10, intervalMs: 500 },
    );
    const count = await sections.count();
    assert.ok(
      count >= minSections,
      `Expected at least ${minSections} plan sections, got ${count}`,
    );
  },
);

When(
  "I add feedback {string} to the first section",
  async function (this: KoluWorld, feedbackText: string) {
    // Hover the first section to reveal the feedback button
    const section = this.page.locator('[data-testid="plan-section"]').first();
    await section.hover();

    // Click the add feedback button
    const addBtn = section.locator('[data-testid="add-feedback-btn"]');
    await addBtn.click();

    // Type the feedback
    const input = this.page.locator('[data-testid="feedback-input"]');
    await input.fill(feedbackText);

    // Submit
    const submitBtn = this.page.locator('[data-testid="submit-feedback-btn"]');
    await submitBtn.click();

    // Wait for the mutation to complete
    await this.page.waitForTimeout(1000);
  },
);

Then(
  "the plan file should contain feedback {string}",
  async function (this: KoluWorld, expectedFeedback: string) {
    if (!projectDir) throw new Error("No project directory created");
    const plansDir = path.join(projectDir, ".claude", "plans");
    const files = fs.readdirSync(plansDir).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, "No plan files found");

    // Check any plan file contains the feedback
    let found = false;
    for (const file of files) {
      const content = fs.readFileSync(path.join(plansDir, file), "utf8");
      if (content.includes(`> [FEEDBACK]: ${expectedFeedback}`)) {
        found = true;
        break;
      }
    }
    assert.ok(found, `Expected feedback "${expectedFeedback}" in plan file`);
  },
);

When("I close the plan pane", async function (this: KoluWorld) {
  const closeBtn = this.page.locator('[data-testid="close-plan-btn"]');
  await closeBtn.click();
});
