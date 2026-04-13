/**
 * Claude Code status detection — step definitions.
 *
 * Mocks Claude Code sessions by creating fake session files and JSONL transcripts
 * in the test's configurable directories (KOLU_CLAUDE_SESSIONS_DIR / KOLU_CLAUDE_PROJECTS_DIR).
 *
 * Uses the terminal's own shell PID as the fake "Claude Code PID" — when
 * nothing else is running, the pty's foreground process group leader is the
 * shell itself, so a session file at ~/.claude/sessions/<shell-pid>.json
 * makes the provider's foreground-pid lookup succeed.
 */

import { When, Then, After } from "@cucumber/cucumber";
import * as fs from "node:fs";
import * as path from "node:path";
import * as assert from "node:assert";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { readBufferText, ACTIVE_TERMINAL } from "../support/buffer.ts";

const SESSION_ID = "test-claude-session-00000000-0000-0000-0000";
// Read these lazily rather than at module load — `hooks.ts` sets per-worker
// temp dirs on `process.env`, and cucumber's step/support module import
// order is not guaranteed, so a top-level capture here would race.
const getSessionsDir = () => process.env.KOLU_CLAUDE_SESSIONS_DIR;
const getProjectsDir = () => process.env.KOLU_CLAUDE_PROJECTS_DIR;

/** Get the terminal shell PID by reading the xterm buffer after `echo $$`. */
async function getTerminalPid(world: KoluWorld): Promise<number> {
  const marker = `PID_MARKER_${Date.now()}`;
  await world.page.keyboard.type(`echo $$; echo ${marker}`);
  await world.page.keyboard.press("Enter");
  // Wait for the marker to appear in the buffer, then parse the PID from
  // the surrounding lines — all inside waitForFunction so the buffer read
  // and parse happen atomically in the browser context per rAF cycle.
  // Uses the shared __readXtermBuffer helper (injected by hooks.ts).
  const handle = await world.page.waitForFunction(
    ({ marker, sel }) => {
      const text = (window as any).__readXtermBuffer(sel, 0) as string;
      if (!text) return null;
      const lines = text.split("\n").map((l: string) => l.trim());
      // Find the marker on a line that's NOT the typed echo command.
      const markerIdx = lines.findIndex(
        (l: string) => l.includes(marker) && !l.includes("echo"),
      );
      if (markerIdx <= 0) return null;
      // Walk backwards from marker to find the PID (first purely numeric line).
      for (let i = markerIdx - 1; i >= 0; i--) {
        const num = parseInt(lines[i]!, 10);
        if (!isNaN(num) && num > 0 && String(num) === lines[i]) return num;
      }
      return null;
    },
    { marker, sel: ACTIVE_TERMINAL },
    { timeout: POLL_TIMEOUT },
  );
  const pid = await handle.jsonValue();
  if (pid === null) {
    const text = await readBufferText(world.page);
    throw new Error(
      `getTerminalPid: PID not parseable from buffer (marker=${marker}):\n${text.slice(0, 800)}`,
    );
  }
  return pid;
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
    const sessionsDir = getSessionsDir();
    const projectsDir = getProjectsDir();
    if (!sessionsDir || !projectsDir) {
      throw new Error(
        "KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR must be set",
      );
    }

    cleanup();

    const pid = await getTerminalPid(this);

    // Unique CWD per scenario to avoid parallel worker collisions
    mockCwd = `/tmp/claude-test-${pid}-${Date.now()}`;
    const encodedCwd = mockCwd.replace(/[/.]/g, "-");

    // ORDER MATTERS — write the JSONL transcript and project dir BEFORE the
    // session file. The session file is the "trigger": when the server's
    // SESSIONS_DIR watcher fires on its creation, it immediately calls
    // findTranscriptPath(session). If the JSONL doesn't exist yet, the
    // server enters a "waiting on project dir" state that depends on a
    // *second* fs.watch event firing — and under parallel-worker inotify
    // pressure that second event is exactly the one most likely to drop.
    // Writing data-then-trigger removes the second-event dependency.
    fs.mkdirSync(projectsDir, { recursive: true });
    mockProjectDir = path.join(projectsDir, encodedCwd);
    fs.mkdirSync(mockProjectDir, { recursive: true });
    mockTranscriptPath = path.join(mockProjectDir, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(
      mockTranscriptPath,
      buildTranscript(state as "thinking" | "tool_use" | "waiting"),
    );

    // Now the trigger — session file last.
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionData = {
      pid,
      sessionId: SESSION_ID,
      cwd: mockCwd,
      startedAt: Date.now(),
    };
    mockSessionFile = path.join(sessionsDir, `${pid}.json`);
    fs.writeFileSync(mockSessionFile, JSON.stringify(sessionData));
  },
);

/** Re-touch the mock files so a dropped fs.watch event can't deadlock detection.
 *
 *  fs.watch (inotify on Linux, FSEvents on darwin) is a single-shot best-effort
 *  notification — under heavy load both backends silently drop events. The server
 *  has no polling fallback, so a single missed event can wedge a scenario. Tests
 *  re-touch the trigger files on each poll iteration so detection retries are
 *  driven by *us*, not by hoping the kernel queue stays warm. */
function nudgeMockFiles() {
  const now = new Date();
  for (const p of [mockSessionFile, mockTranscriptPath]) {
    if (p) {
      try {
        fs.utimesSync(p, now, now);
      } catch {
        // file may have been cleaned up between iterations — fine
      }
    }
  }
}

When(
  "a newer stale previous-session JSONL exists in the same project dir",
  async function (this: KoluWorld) {
    // Regression guard: previously `findTranscriptPath` had an MRU fallback
    // that picked the most recently modified JSONL in the project dir — so a
    // previous session's transcript could capture the watcher while the
    // current session's JSONL was still being created.
    //
    // This step bumps the stale file's mtime into the future so an MRU
    // scan would always prefer it over the mock's current-session JSONL.
    // With the fix, exact-match lookup ignores the stale file entirely.
    const projectsDir = getProjectsDir();
    if (!projectsDir) throw new Error("KOLU_CLAUDE_PROJECTS_DIR must be set");
    if (!mockCwd) throw new Error("mockCwd not set — call mock step first");
    const encodedCwd = mockCwd.replace(/[/.]/g, "-");
    const projectDir = path.join(projectsDir, encodedCwd);
    const stalePath = path.join(projectDir, "stale-previous-session.jsonl");
    fs.writeFileSync(
      stalePath,
      JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "previous" }],
        },
      }) + "\n",
    );
    // Future mtime so an MRU fallback would always pick this over the
    // current-session JSONL.
    const future = new Date(Date.now() + 60_000);
    fs.utimesSync(stalePath, future, future);
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
  "the header should show an agent indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    // Polled check with periodic mock-file re-touch — see nudgeMockFiles().
    // Same total budget as a bare waitForFunction(POLL_TIMEOUT); we just slice
    // it into ~250ms ticks and re-trigger the server's fs.watch each tick.
    const start = Date.now();
    let last: string | null = null;
    while (Date.now() - start < POLL_TIMEOUT) {
      nudgeMockFiles();
      last = await this.page.evaluate(() => {
        const el = document.querySelector('[data-testid="agent-indicator"]');
        return el?.getAttribute("data-agent-state") ?? null;
      });
      if (last === expectedState) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `Expected agent indicator state "${expectedState}", got "${last}" after ${POLL_TIMEOUT}ms`,
    );
  },
);

/** Assert an agent-indicator exists within the given container testid. */
async function expectAgentIndicatorIn(world: KoluWorld, testId: string) {
  await world.page.waitForFunction(
    (testId) =>
      document.querySelector(
        `[data-testid="${testId}"] [data-testid="agent-indicator"]`,
      ) !== null,
    testId,
    { timeout: POLL_TIMEOUT },
  );
}

Then(
  "the sidebar should show an agent indicator",
  async function (this: KoluWorld) {
    await expectAgentIndicatorIn(this, "sidebar");
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

When(
  "I set the agent previews mode to {string}",
  async function (this: KoluWorld, mode: string) {
    await this.page.click(`[data-testid="sidebar-agent-previews-${mode}"]`);
    await this.waitForFrame();
  },
);

Then(
  "palette item {string} should not be visible",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator('[data-testid="command-palette"]');
    const item = palette
      .locator("li")
      .filter({ hasText: new RegExp(`^${text}`) });
    const count = await item.count();
    assert.strictEqual(
      count,
      0,
      `Expected palette item "${text}" to be hidden, but found ${count}`,
    );
  },
);

/** Build JSONL lines for TaskCreate result + TaskUpdate calls. */
function buildTaskLines(
  tasks: Array<{ id: string; subject: string; status: string }>,
): string {
  const lines: string[] = [];
  for (const task of tasks) {
    // TaskCreate result (appears on "user" type messages)
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: `task-create-${task.id}`,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              tool_use_id: `tool-${task.id}`,
              type: "tool_result",
              content: `Task #${task.id} created successfully: ${task.subject}`,
            },
          ],
        },
        toolUseResult: { task: { id: task.id, subject: task.subject } },
      }),
    );
    // TaskUpdate to set status (appears on "assistant" type messages)
    if (task.status !== "pending") {
      lines.push(
        JSON.stringify({
          type: "assistant",
          uuid: `task-update-${task.id}`,
          timestamp: new Date().toISOString(),
          message: {
            model: "claude-opus-4-6",
            role: "assistant",
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: `tool-update-${task.id}`,
                name: "TaskUpdate",
                input: { taskId: task.id, status: task.status },
              },
            ],
          },
        }),
      );
    }
  }
  return lines.join("\n") + "\n";
}

When(
  "the Claude Code session has {int} tasks with {int} completed",
  async function (this: KoluWorld, total: number, completed: number) {
    if (!mockTranscriptPath) throw new Error("No mock transcript to update");
    const tasks: Array<{ id: string; subject: string; status: string }> = [];
    for (let i = 1; i <= total; i++) {
      tasks.push({
        id: String(i),
        subject: `Task ${i}`,
        status: i <= completed ? "completed" : "in_progress",
      });
    }
    // Append task lines to existing transcript
    fs.appendFileSync(mockTranscriptPath, buildTaskLines(tasks));
  },
);

Then(
  "the sidebar should show task progress {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (expected) => {
        const el = document.querySelector(
          '[data-testid="agent-task-progress"]',
        );
        return el?.textContent?.trim() === expected;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the header should not show an agent indicator",
  async function (this: KoluWorld) {
    await this.page.waitForFunction(
      () => document.querySelector('[data-testid="agent-indicator"]') === null,
      { timeout: POLL_TIMEOUT },
    );
  },
);
