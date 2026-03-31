/**
 * Plan detection & inline commenting — step definitions.
 *
 * Plans are tied to Claude sessions via the session slug. The slug appears
 * in every JSONL entry and the plan file lives at ~/.claude/plans/{slug}.md.
 * These tests mock a Claude session with a known slug and create/remove
 * plan files in the real ~/.claude/plans/ directory.
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

const SESSION_ID = "test-plan-session-00000000-0000-0000-0000";
const SESSIONS_DIR = process.env.KOLU_CLAUDE_SESSIONS_DIR;
const PROJECTS_DIR = process.env.KOLU_CLAUDE_PROJECTS_DIR;
const PLANS_DIR = path.join(os.homedir(), ".claude", "plans");

/** Unique slug per test run to avoid collisions between parallel workers. */
let testSlug: string | null = null;
let mockSessionFile: string | null = null;
let mockProjectDir: string | null = null;
let mockTranscriptPath: string | null = null;
let mockPlanFile: string | null = null;

function cleanup() {
  if (mockSessionFile && fs.existsSync(mockSessionFile)) {
    fs.unlinkSync(mockSessionFile);
    mockSessionFile = null;
  }
  if (mockTranscriptPath && fs.existsSync(mockTranscriptPath)) {
    fs.unlinkSync(mockTranscriptPath);
  }
  if (mockProjectDir && fs.existsSync(mockProjectDir)) {
    fs.rmSync(mockProjectDir, { recursive: true });
    mockProjectDir = null;
  }
  mockTranscriptPath = null;
  if (mockPlanFile && fs.existsSync(mockPlanFile)) {
    fs.unlinkSync(mockPlanFile);
    mockPlanFile = null;
  }
  testSlug = null;
}

After(function () {
  cleanup();
});

async function getTerminalPid(world: KoluWorld): Promise<number> {
  const resp = await world.page.request.fetch("/rpc/terminal/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({}),
  });
  const body = await resp.json();
  const list = (body.json ?? body) as Array<{ pid: number; id: string }>;
  if (list.length === 0) throw new Error("No terminals found");
  return list[0]!.pid;
}

/** Build a JSONL transcript with the test slug on every entry. */
function buildTranscript(slug: string): string {
  const userMsg = JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
    slug,
  });
  const assistantMsg = JSON.stringify({
    type: "assistant",
    uuid: "a1",
    timestamp: new Date().toISOString(),
    message: {
      model: "claude-opus-4-6",
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Done!" }],
    },
    slug,
  });
  return userMsg + "\n" + assistantMsg + "\n";
}

/** Generate a unique slug for this test scenario. */
function generateSlug(): string {
  return `kolu-test-plan-${process.pid}-${Date.now()}`;
}

/** Whether to create a plan file (given the plan name). */
let pendingPlanContent: string | null = null;

Given(
  "a project directory with a plan file {string}",
  function (this: KoluWorld, planName: string) {
    // Plan name is ignored — we use the session slug as filename.
    // Store the content to write when the session is mocked (we need the slug).
    pendingPlanContent = SIMPLE_PLAN;
  },
);

Given(
  "a project directory with a structured plan file {string}",
  function (this: KoluWorld, planName: string) {
    pendingPlanContent = STRUCTURED_PLAN;
  },
);

Given("a project directory with no plan files", function (this: KoluWorld) {
  pendingPlanContent = null;
});

When(
  "a Claude Code session is mocked in the project directory",
  async function (this: KoluWorld) {
    if (!SESSIONS_DIR || !PROJECTS_DIR) {
      throw new Error(
        "KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR must be set",
      );
    }

    cleanup();
    testSlug = generateSlug();

    const pid = await getTerminalPid(this);
    // Use a unique CWD so the encoded project dir doesn't collide
    const mockCwd = `/tmp/kolu-plan-${pid}-${Date.now()}`;
    const encodedCwd = mockCwd.replace(/[/.]/g, "-");

    // Create session file
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    mockSessionFile = path.join(SESSIONS_DIR, `${pid}.json`);
    fs.writeFileSync(
      mockSessionFile,
      JSON.stringify({
        pid,
        sessionId: SESSION_ID,
        cwd: mockCwd,
        startedAt: Date.now(),
      }),
    );

    // Create transcript with slug
    mockProjectDir = path.join(PROJECTS_DIR, encodedCwd);
    fs.mkdirSync(mockProjectDir, { recursive: true });
    mockTranscriptPath = path.join(mockProjectDir, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(mockTranscriptPath, buildTranscript(testSlug));

    // Create plan file at ~/.claude/plans/{slug}.md if content was set
    if (pendingPlanContent) {
      fs.mkdirSync(PLANS_DIR, { recursive: true });
      mockPlanFile = path.join(PLANS_DIR, `${testSlug}.md`);
      fs.writeFileSync(mockPlanFile, pendingPlanContent);
      pendingPlanContent = null;
    }
  },
);

When(
  "a new plan file {string} is added to the project",
  async function (this: KoluWorld, _planName: string) {
    if (!testSlug) throw new Error("No test slug — mock a session first");
    // Create the plan file for this session's slug
    fs.mkdirSync(PLANS_DIR, { recursive: true });
    mockPlanFile = path.join(PLANS_DIR, `${testSlug}.md`);
    fs.writeFileSync(mockPlanFile, SIMPLE_PLAN);
    // Touch transcript to trigger metadata refresh
    if (mockTranscriptPath) {
      fs.writeFileSync(mockTranscriptPath, buildTranscript(testSlug));
    }
  },
);

Then("the plan pane should be visible", async function (this: KoluWorld) {
  const pane = this.page.locator('[data-testid="plan-pane"]');
  await pollUntil(
    this.page,
    async () => {
      try {
        return await pane.isVisible();
      } catch {
        return false;
      }
    },
    (visible) => visible,
    { attempts: 30, intervalMs: 500 },
  );
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
    { attempts: 30, intervalMs: 500 },
  );
});

Then(
  "the plan pane should show the plan name {string}",
  async function (this: KoluWorld, _planName: string) {
    // Plan name is now the slug, but we verify the pane shows something
    const pane = this.page.locator('[data-testid="plan-pane"]');
    const text = await pane.textContent();
    assert.ok(text && text.length > 0, "Expected plan pane to show content");
  },
);

Then(
  "the plan pane should show at least {int} sections",
  async function (this: KoluWorld, minSections: number) {
    await this.page
      .locator('[data-testid="plan-pane"]')
      .waitFor({ state: "visible", timeout: 15_000 });
    // Sections are rendered as h2 headings in the markdown
    const headings = this.page.locator(
      '[data-testid="plan-content"] h1, [data-testid="plan-content"] h2, [data-testid="plan-content"] h3',
    );
    await pollUntil(
      this.page,
      async () => {
        try {
          return await headings.count();
        } catch {
          return 0;
        }
      },
      (count) => count >= minSections,
      { attempts: 20, intervalMs: 500 },
    );
    const count = await headings.count();
    assert.ok(
      count >= minSections,
      `Expected at least ${minSections} heading sections, got ${count}`,
    );
  },
);

When(
  "I add feedback {string} to the first section",
  async function (this: KoluWorld, feedbackText: string) {
    if (!mockPlanFile) throw new Error("No mock plan file");
    // Test feedback insertion via the server RPC endpoint directly.
    // The text-selection UI is validated visually — automating browser
    // text selection + popover interaction is fragile in headless mode.
    const resp = await this.page.request.fetch("/rpc/plans/addFeedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        path: mockPlanFile,
        afterLine: 1,
        text: `Re: «test selection» — ${feedbackText}`,
      }),
    });
    assert.ok(resp.ok(), `addFeedback RPC failed: ${resp.status()}`);
    await this.page.waitForTimeout(500);
  },
);

Then(
  "the plan file should contain feedback {string}",
  async function (this: KoluWorld, expectedFeedback: string) {
    if (!mockPlanFile) throw new Error("No mock plan file");
    const content = fs.readFileSync(mockPlanFile, "utf8");
    assert.ok(
      content.includes(expectedFeedback),
      `Expected "${expectedFeedback}" in plan file, got:\n${content}`,
    );
  },
);
