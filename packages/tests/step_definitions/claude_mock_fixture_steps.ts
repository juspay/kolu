/**
 * Claude Code mock as a UI FIXTURE (not agent detection).
 *
 * The real-agent migration (token OLLAMA-E2E-R3W7) deleted the mock
 * agent-detection scenarios + their `claude_code_steps.ts`. This file keeps the
 * *minimum* claude mock needed as a UI fixture for one scenario the master merge
 * brought in: `activity-alerts.feature`'s "An agent awaiting you badges the PWA
 * dock icon" (the W5 cross-host attention feature). That scenario tests the
 * BADGE — padi's `urgency` fold → the client's cross-host watcher → the PWA app
 * badge — and needs exactly one claude session reporting `awaiting_user` as its
 * input. `awaiting_user` (a pending AskUserQuestion / ExitPlanMode tool) is not
 * deterministically elicitable from the dumb ollama model the CI box runs, so a
 * REAL agent can't drive it — this is the coordinator's DECOUPLE precedent
 * (mock-as-UI-fixture for a non-detection UI concern, same as the dock/ping
 * scenarios), pared to the single state the badge scenario asserts.
 *
 * Adapted to the post-knob-removal paths: there is no `KOLU_CLAUDE_*_DIR` knob
 * anymore, so the mock writes under the throwaway `$HOME` (`KOLU_E2E_FIXTURE_HOME`)
 * exactly where the provider's `SESSIONS_DIR` / `PROJECTS_DIR`
 * (`os.homedir()/.claude/{sessions,projects}`, claude-code/src/core.ts) resolve.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL, readBufferText } from "../support/buffer.ts";
import { nudgeFiles } from "../support/nudge.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const SESSION_ID = "test-claude-session-00000000-0000-0000-0000";

/** The throwaway `$HOME` the server + providers run under (hooks.ts seeds it and
 *  sets `HOME`); the real default claude paths live under it, not the cucumber
 *  process's own homedir. Fail loud if unset — the suite always seeds it. */
function fixtureHome(): string {
  const home = process.env.KOLU_E2E_FIXTURE_HOME;
  if (!home) {
    throw new Error(
      "KOLU_E2E_FIXTURE_HOME unset — the e2e suite runs via `just test`, which seeds the throwaway home.",
    );
  }
  return home;
}

const sessionsDir = () => path.join(fixtureHome(), ".claude", "sessions");
const projectsDir = () => path.join(fixtureHome(), ".claude", "projects");

/** Get the terminal shell PID by reading the xterm buffer after `echo $$`. */
async function getTerminalPid(world: KoluWorld): Promise<number> {
  const marker = `PID_MARKER_${Date.now()}`;
  await world.page.keyboard.type(`echo $$; echo ${marker}`);
  await world.page.keyboard.press("Enter");
  const handle = await world.page.waitForFunction(
    ({ marker, sel }) => {
      const text = window.__readXtermBuffer?.(sel, 0) ?? "";
      if (!text) return null;
      const lines = text.split("\n").map((l: string) => l.trim());
      const markerIdx = lines.findIndex(
        (l: string) => l.includes(marker) && !l.includes("echo"),
      );
      if (markerIdx <= 0) return null;
      for (let i = markerIdx - 1; i >= 0; i--) {
        const line = lines[i];
        if (line === undefined) continue;
        const num = parseInt(line, 10);
        if (!Number.isNaN(num) && num > 0 && String(num) === line) return num;
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

/** A JSONL transcript whose final turn ended on a pending AskUserQuestion tool,
 *  so `deriveState`'s awaiting-user branch reports `awaiting_user`. Only this
 *  one state is needed (the badge scenario); anything else fails loud. */
function buildTranscript(state: string): string {
  if (state !== "awaiting_user") {
    throw new Error(
      `claude_mock_fixture_steps supports only "awaiting_user" (the PWA-badge fixture); got "${state}". The full multi-state mock lives in git history (pre-OLLAMA-E2E-R3W7 claude_code_steps.ts).`,
    );
  }
  const userMsg = JSON.stringify({
    type: "user",
    uuid: "u1",
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: "hello" }] },
  });
  const assistantMsg = JSON.stringify({
    type: "assistant",
    uuid: "a1",
    timestamp: new Date().toISOString(),
    message: {
      model: "claude-opus-4-6",
      role: "assistant",
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "tu-ask", name: "AskUserQuestion", input: {} },
      ],
    },
  });
  return `${userMsg}\n${assistantMsg}\n`;
}

let mockTranscriptPath: string | null = null;
let mockSessionFile: string | null = null;

function cleanup() {
  if (mockTranscriptPath && fs.existsSync(mockTranscriptPath)) {
    fs.unlinkSync(mockTranscriptPath);
  }
  if (mockSessionFile && fs.existsSync(mockSessionFile)) {
    fs.unlinkSync(mockSessionFile);
  }
  mockTranscriptPath = null;
  mockSessionFile = null;
}

After(() => {
  cleanup();
});

/** Re-touch the mock files each poll tick so a dropped fs.watch event under
 *  parallel-worker inotify pressure can't deadlock detection (same axis as
 *  `nudgeWal`). */
function nudgeMockFiles() {
  nudgeFiles([mockSessionFile ?? undefined, mockTranscriptPath ?? undefined]);
}

When(
  "a Claude Code session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    cleanup();

    const pid = await getTerminalPid(this);
    // Unique cwd per scenario to avoid parallel-worker collisions; the provider
    // keys the transcript dir off the session's cwd with the same encoding.
    const mockCwd = `/tmp/claude-test-${pid}-${Date.now()}`;
    const encodedCwd = mockCwd.replace(/[/.]/g, "-");

    // ORDER MATTERS — write the transcript BEFORE the session file. The session
    // file is the trigger the SESSIONS_DIR watcher fires on; if the JSONL isn't
    // there yet, detection depends on a second fs.watch event that is the one
    // most likely to drop under inotify pressure. Data-then-trigger avoids it.
    const projDir = path.join(projectsDir(), encodedCwd);
    fs.mkdirSync(projDir, { recursive: true });
    mockTranscriptPath = path.join(projDir, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(mockTranscriptPath, buildTranscript(state));

    fs.mkdirSync(sessionsDir(), { recursive: true });
    mockSessionFile = path.join(sessionsDir(), `${pid}.json`);
    fs.writeFileSync(
      mockSessionFile,
      JSON.stringify({
        pid,
        sessionId: SESSION_ID,
        cwd: mockCwd,
        startedAt: Date.now(),
      }),
    );
  },
);

Then(
  "the tile chrome should show an agent indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
          );
          return el?.getAttribute("data-agent-state") ?? null;
        }),
      isDone: (v) => v === expectedState,
      onTick: nudgeMockFiles,
      onTimeout: (last, elapsed) =>
        new Error(
          `Expected agent indicator state "${expectedState}", got "${last}" after ${elapsed}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
