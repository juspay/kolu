/**
 * Claude Code status detection — step definitions.
 *
 * Mocks Claude Code sessions by creating fake session files and JSONL transcripts
 * in the test's configurable directories (KOLU_CLAUDE_SESSIONS_DIR / KOLU_CLAUDE_PROJECTS_DIR).
 *
 * Uses the terminal's own shell PID as the fake "Claude Code PID" — since
 * the shell PID is alive and its stdin points to the terminal's PTY, the
 * provider's PTY matching logic treats it as a match.
 */

import { When, Then, Before, After } from "@cucumber/cucumber";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "node:assert";
import { KoluWorld } from "../support/world.ts";
import { pollUntilBufferContains } from "../support/buffer.ts";
import { pollUntil } from "../support/poll.ts";

const SESSION_ID = "test-claude-session-00000000-0000-0000-0000";
const SESSIONS_DIR = process.env.KOLU_CLAUDE_SESSIONS_DIR;
const PROJECTS_DIR = process.env.KOLU_CLAUDE_PROJECTS_DIR;

// Skip on macOS — PTY matching relies on /proc which doesn't exist there
Before({ tags: "@claude-mock" }, function () {
  if (os.platform() !== "linux") {
    return "skipped";
  }
});

/** Get the terminal shell PID by reading the xterm buffer after `echo $$`. */
async function getTerminalPid(world: KoluWorld): Promise<number> {
  const marker = `PID_MARKER_${Date.now()}`;
  await world.page.keyboard.type(`echo $$; echo ${marker}`);
  await world.page.keyboard.press("Enter");
  // Wait for the marker to appear — guarantees the PID output is complete
  const text = await pollUntilBufferContains(world.page, marker);
  // The PID is the line immediately before the marker line
  const lines = text.split("\n").map((l) => l.trim());
  const markerIdx = lines.findIndex(
    (l) => l.includes(marker) && !l.includes("echo"),
  );
  if (markerIdx <= 0)
    throw new Error(
      `Could not find marker output in buffer:\n${text.slice(0, 800)}`,
    );
  // Walk backwards from marker to find the PID (first purely numeric line)
  for (let i = markerIdx - 1; i >= 0; i--) {
    const num = parseInt(lines[i]!, 10);
    if (!isNaN(num) && num > 0 && String(num) === lines[i]) return num;
  }
  throw new Error(
    `Could not parse PID from buffer before marker:\n${text.slice(0, 800)}`,
  );
}

/** Build a JSONL transcript with a specific final state. */
function buildTranscript(state: "thinking" | "tool_use" | "waiting"): string {
  const userMsg = JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  });

  const assistantMsg = (stopReason: string) =>
    JSON.stringify({
      type: "assistant",
      uuid: "a1",
      timestamp: new Date().toISOString(),
      message: {
        model: "claude-opus-4-6",
        role: "assistant",
        stop_reason: stopReason,
        content: [{ type: "text", text: "Done!" }],
      },
    });

  const lines = [userMsg];
  if (state === "tool_use") lines.push(assistantMsg("tool_use"));
  if (state === "waiting") lines.push(assistantMsg("end_turn"));
  // "thinking" = user message only (no assistant response yet)

  return lines.join("\n") + "\n";
}

/** Unique CWD per scenario to avoid collisions in parallel workers. */
let mockCwd: string | null = null;

/** Track mock files for cleanup. */
let mockSessionFile: string | null = null;
let mockProjectDir: string | null = null;
let mockTranscriptPath: string | null = null;

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
}

After(function () {
  cleanup();
});

When(
  "a Claude Code session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    if (!SESSIONS_DIR || !PROJECTS_DIR) {
      throw new Error(
        "KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR must be set",
      );
    }

    cleanup();

    const pid = await getTerminalPid(this);

    // Unique CWD per scenario to avoid parallel worker collisions
    mockCwd = `/tmp/claude-test-${pid}-${Date.now()}`;
    const encodedCwd = mockCwd.replace(/[/.]/g, "-");

    // Create session file
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    const sessionData = {
      pid,
      sessionId: SESSION_ID,
      cwd: mockCwd,
      startedAt: Date.now(),
    };
    mockSessionFile = path.join(SESSIONS_DIR, `${pid}.json`);
    fs.writeFileSync(mockSessionFile, JSON.stringify(sessionData));

    // Create project dir and transcript
    mockProjectDir = path.join(PROJECTS_DIR, encodedCwd);
    fs.mkdirSync(mockProjectDir, { recursive: true });
    mockTranscriptPath = path.join(mockProjectDir, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(
      mockTranscriptPath,
      buildTranscript(state as "thinking" | "tool_use" | "waiting"),
    );
  },
);

When(
  "the Claude Code session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockTranscriptPath) throw new Error("No mock transcript to update");
    fs.writeFileSync(
      mockTranscriptPath,
      buildTranscript(state as "thinking" | "tool_use" | "waiting"),
    );
  },
);

When("the Claude Code session ends", async function (this: KoluWorld) {
  cleanup();
});

Then(
  "the header should show a Claude indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    const el = this.page.locator('[data-testid="claude-indicator"]');
    const state = await pollUntil(
      this.page,
      async () => {
        try {
          // There may be multiple (header + sidebar). Check the first one.
          const first = el.first();
          return (
            (await first.getAttribute("data-claude-state", {
              timeout: 1000,
            })) ?? ""
          );
        } catch {
          return "";
        }
      },
      (s) => s === expectedState,
      { attempts: 30, intervalMs: 200 },
    );
    assert.strictEqual(
      state,
      expectedState,
      `Expected Claude indicator state "${expectedState}", got "${state}"`,
    );
  },
);

/** Assert a claude-indicator exists within the given container testid. */
async function expectClaudeIndicatorIn(world: KoluWorld, testId: string) {
  const container = world.page.locator(`[data-testid="${testId}"]`);
  const indicator = container.locator('[data-testid="claude-indicator"]');
  await pollUntil(
    world.page,
    async () => {
      try {
        return await indicator.count();
      } catch {
        return 0;
      }
    },
    (count) => count > 0,
    { attempts: 30, intervalMs: 200 },
  );
  const count = await indicator.count();
  assert.ok(
    count > 0,
    `Expected Claude indicator in [data-testid="${testId}"]`,
  );
}

Then(
  "the sidebar should show a Claude indicator",
  async function (this: KoluWorld) {
    await expectClaudeIndicatorIn(this, "sidebar");
  },
);

Then(
  "the sidebar should show a terminal preview",
  async function (this: KoluWorld) {
    const sidebar = this.page.locator('[data-testid="sidebar"]');
    const preview = sidebar.locator('[data-testid="sidebar-preview"]');
    await preview.first().waitFor({ state: "visible", timeout: 10_000 });
    const count = await preview.count();
    assert.ok(count > 0, "Expected at least one sidebar preview");
  },
);

Then(
  "the sidebar should not show a terminal preview",
  async function (this: KoluWorld) {
    const sidebar = this.page.locator('[data-testid="sidebar"]');
    const preview = sidebar.locator('[data-testid="sidebar-preview"]');
    await preview.first().waitFor({ state: "hidden", timeout: 10_000 });
  },
);

When("I click the agent previews toggle", async function (this: KoluWorld) {
  await this.page.click('[data-testid="sidebar-agent-previews-toggle"]');
  await this.waitForFrame();
});

Then(
  "the header should not show a Claude indicator",
  async function (this: KoluWorld) {
    // Wait for it to disappear (may take a poll cycle)
    await pollUntil(
      this.page,
      async () => {
        try {
          return await this.page
            .locator('[data-testid="claude-indicator"]')
            .count();
        } catch {
          return 0;
        }
      },
      (count) => count === 0,
      { attempts: 30, intervalMs: 200 },
    );
    const count = await this.page
      .locator('[data-testid="claude-indicator"]')
      .count();
    assert.strictEqual(
      count,
      0,
      `Expected no Claude indicator but found ${count}`,
    );
  },
);
