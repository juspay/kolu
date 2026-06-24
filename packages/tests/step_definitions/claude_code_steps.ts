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

import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL, readBufferText } from "../support/buffer.ts";
import { nudgeDir, nudgeFiles } from "../support/nudge.ts";
import { pollFor } from "../support/poll.ts";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const SESSION_ID = "test-claude-session-00000000-0000-0000-0000";
/** Dynamic-workflow fixtures: a launched background task + its run journal. */
const WORKFLOW_TASK_ID = "task-bg-0000";
const WORKFLOW_RUN_ID = "wf-test-run-0000";
const WORKFLOW_NAME = "deep-research";
const WORKFLOW_AGENTS = 5;

type MockState =
  | "thinking"
  | "tool_use"
  | "waiting"
  | "awaiting_user"
  | "running_background"
  | "orphaned_workflow"
  | "journalless_workflow"
  | "background_bash"
  | "fork"
  | "interrupted"
  | "interrupted_tool_use"
  | "compact";

/** A `/fork` sub-agent id — the `agent-<id>` basename of its on-disk artifacts,
 *  identical to the completion notification's `<task-id>`. The `a` prefix mirrors
 *  the real async-agent id format. */
const FORK_SUBAGENT_ID = "aimplement-it-test00000000000000";
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
      const text = window.__readXtermBuffer?.(sel, 0) ?? "";
      if (!text) return null;
      const lines = text.split("\n").map((l: string) => l.trim());
      // Find the marker on a line that's NOT the typed echo command.
      const markerIdx = lines.findIndex(
        (l: string) => l.includes(marker) && !l.includes("echo"),
      );
      if (markerIdx <= 0) return null;
      // Walk backwards from marker to find the PID (first purely numeric line).
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

/** Build a JSONL transcript with a specific final state. */
function buildTranscript(state: MockState): string {
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

  const interruptTextMsg = (uuid: string, text: string) =>
    JSON.stringify({
      type: "user",
      uuid,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [{ type: "text", text }] },
    });

  const lines = [userMsg];
  if (state === "tool_use") lines.push(assistantMsg("tool_use"));
  if (state === "waiting") lines.push(assistantMsg("end_turn"));
  // "awaiting_user": the turn ended on a user-input tool (AskUserQuestion /
  // ExitPlanMode), so `deriveState`'s `toolUseOrAwaitingUser` sees only
  // awaiting-user tools pending and reports `awaiting_user` — the genuinely
  // blocked-on-you state that ranks `need` and gets the dock's full card.
  // (Distinct from `waiting`, the post-turn lull that now ranks idle.)
  if (state === "awaiting_user") {
    lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: "a1",
        timestamp: new Date().toISOString(),
        message: {
          model: "claude-opus-4-6",
          role: "assistant",
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "tu-ask",
              name: "AskUserQuestion",
              input: {},
            },
          ],
        },
      }),
    );
  }
  // "running_background": a launched-but-uncompleted `Workflow` task (carries a
  // Run ID → has a journal) followed by an end-of-turn — deriveState promotes
  // the bare `waiting` to `running_background`. "orphaned_workflow" uses the
  // same transcript, but the mock step back-dates its journal so the run reads
  // as dead (a restart orphaned it) and the promotion is vetoed.
  // "journalless_workflow" uses the same Workflow-launch transcript but the mock
  // step writes NO journal and no `workflows/` dir, so the run carries a Run ID
  // kolu can never observe. Pre-fix that promoted to `running_background` forever
  // (the phantom bug F3 flagged); post-fix the gate has no liveness anchor and
  // demotes to `waiting` rather than spinning indefinitely.
  if (
    state === "running_background" ||
    state === "orphaned_workflow" ||
    state === "journalless_workflow"
  ) {
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-bg",
              content: `Workflow launched in background. Task ID: ${WORKFLOW_TASK_ID}\nRun ID: ${WORKFLOW_RUN_ID}`,
            },
          ],
        },
      }),
    );
    lines.push(assistantMsg("end_turn"));
  }
  // "background_bash": a backgrounded Bash command (no Run ID → runId null, no
  // journal) with no completion. The launch marker is permanent in the
  // transcript, so pre-fix the bare end_turn was promoted to
  // `running_background` forever; post-fix a detached command kolu can't
  // observe is not "working" — it reads as `waiting`.
  if (state === "background_bash") {
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-bash",
              content:
                "Command running in background with ID: bg-bash-0000. Output is being written to: /tmp/bg-bash-0000.output.",
            },
          ],
        },
      }),
    );
    lines.push(assistantMsg("end_turn"));
  }
  // "fork": the main agent ended its turn (end_turn → waiting) and then `/fork`
  // echoed its launch into the transcript as a `system`/`local_command` line —
  // NOT a `tool_result`, so it never enters the background-task accounting.
  // `deriveState` walks past the system line to the prior end_turn and reports
  // `waiting`; the watcher then promotes to `running_background` from the fork's
  // on-disk subagent artifacts (written by `writeForkSubagent`). The trailing
  // local-command here makes the fixture faithful and guards that it doesn't
  // perturb detection.
  if (state === "fork") {
    lines.push(assistantMsg("end_turn"));
    lines.push(
      JSON.stringify({
        type: "system",
        subtype: "local_command",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        content:
          "<local-command-stdout>⑂ forked implement-it (1483)</local-command-stdout>",
        level: "info",
      }),
    );
  }
  // Esc-interrupt: the trailing `user` entry carries an interrupt marker, which
  // `deriveState` classifies as `waiting` (idle), not `thinking` (#1018).
  if (state === "interrupted") {
    lines.push(interruptTextMsg("u2", "[Request interrupted by user]"));
  }
  // Mid-tool-call Esc: an errored `tool_result` then the text marker.
  if (state === "interrupted_tool_use") {
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu-int",
              is_error: true,
              content:
                "The user doesn't want to proceed with this tool use. The tool use was rejected.",
            },
          ],
        },
      }),
      interruptTextMsg("u3", "[Request interrupted by user for tool use]"),
    );
  }
  // "compact": a finished turn (end_turn) followed by the real tail a manual
  // `/compact` leaves behind — the synthetic summary (`isCompactSummary`) AND
  // the slash-command bookkeeping Claude Code appends *after* it, all typed
  // `user`: the caveat, the `<command-name>` invocation, and the
  // `<local-command-stdout>` capture (the newest entry). After a manual compact
  // the agent does not auto-respond, so these sit at the tail; the generic
  // `user` branch read the newest (the command stdout) as a fresh prompt and
  // pinned the pill in `thinking` forever. `deriveState` now walks past all of
  // them to the prior `end_turn` → `waiting`. Modelling only the summary (as an
  // earlier fixture did) never exercised the real bug — the stdout entry sits
  // newer than the summary, so it, not the summary, is what gets misread.
  if (state === "compact") {
    lines.push(assistantMsg("end_turn"));
    const userArtifact = (uuid: string, content: string) =>
      JSON.stringify({
        type: "user",
        uuid,
        timestamp: new Date().toISOString(),
        message: { role: "user", content },
      });
    lines.push(
      JSON.stringify({
        type: "user",
        uuid: "u2",
        isCompactSummary: true,
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: "This session is being continued from a previous…",
        },
      }),
      userArtifact(
        "u3",
        "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>",
      ),
      userArtifact(
        "u4",
        "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>",
      ),
      userArtifact(
        "u5",
        "<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>",
      ),
    );
  }
  // "thinking" = user message only (no assistant response yet)

  return `${lines.join("\n")}\n`;
}

/** Write the run journal a `running_background` mock reads its fan-out from.
 *  `stale: true` back-dates its mtime well past the orphaned-journal window so
 *  the run reads as dead (the "orphaned_workflow" case). */
function writeWorkflowJournal(
  projectDir: string,
  opts: { stale?: boolean } = {},
): void {
  const wfDir = path.join(projectDir, SESSION_ID, "workflows");
  fs.mkdirSync(wfDir, { recursive: true });
  const journalPath = path.join(wfDir, `${WORKFLOW_RUN_ID}.json`);
  fs.writeFileSync(
    journalPath,
    JSON.stringify({
      workflowName: WORKFLOW_NAME,
      status: "running",
      agentCount: WORKFLOW_AGENTS,
    }),
  );
  if (opts.stale) {
    // 10 min ago — comfortably past WORKFLOW_JOURNAL_STALE_MS (2 min), so the
    // still-"running" journal reads as orphaned regardless of poll duration.
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(journalPath, old, old);
  }
}

/** Write a `/fork`'s on-disk artifacts under `<projectDir>/<SESSION_ID>/subagents`:
 *  `agent-<id>.meta.json` tagged `agentType:"fork"` (the discriminator) and a
 *  freshly-written `agent-<id>.jsonl` (the streaming transcript whose mtime is the
 *  liveness anchor). With these present and no completion notification, the watcher
 *  promotes the idle main to `running_background`. Mirrors `writeWorkflowJournal`. */
function writeForkSubagent(projectDir: string): void {
  const subagentsDir = path.join(projectDir, SESSION_ID, "subagents");
  fs.mkdirSync(subagentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(subagentsDir, `agent-${FORK_SUBAGENT_ID}.meta.json`),
    JSON.stringify({
      agentType: "fork",
      description: "implement it!",
      name: "implement-it",
    }),
  );
  fs.writeFileSync(
    path.join(subagentsDir, `agent-${FORK_SUBAGENT_ID}.jsonl`),
    `${JSON.stringify({ type: "user", message: { role: "user", content: "go" } })}\n`,
  );
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

After(() => {
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
    fs.writeFileSync(mockTranscriptPath, buildTranscript(state as MockState));
    if (state === "running_background") writeWorkflowJournal(mockProjectDir);
    if (state === "orphaned_workflow")
      writeWorkflowJournal(mockProjectDir, { stale: true });
    if (state === "fork") writeForkSubagent(mockProjectDir);

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

/** Re-touch the mock files so a dropped fs.watch event can't deadlock
 *  detection. The mechanism (and its rationale) lives in
 *  `support/nudge.ts::nudgeFiles` alongside `nudgeWal` — same volatility
 *  axis (kernel inotify queue overflow under parallel load). */
function nudgeMockFiles() {
  nudgeFiles([mockSessionFile, mockTranscriptPath]);
}

/** Re-fire the SESSIONS_DIR watcher for the *disappearance* assertions.
 *  `nudgeMockFiles` re-touches the mock files to recover a dropped
 *  appearance event — but after `the Claude Code session ends` deletes
 *  them there's nothing left to touch, so a dropped *deletion* event would
 *  leave the server wedged on stale "session present" state and the
 *  indicator never clears (the warm-CI darwin flake at claude-code.feature:144,
 *  failing both cucumber attempts because the same race loses twice). A
 *  create+unlink of a sentinel inside SESSIONS_DIR re-fires the dir watcher
 *  so the server re-reads `<pid>.json`, finds it gone, and drops the
 *  indicator — symmetric with the appearance-side nudge. */
function nudgeSessionsDir() {
  nudgeDir(getSessionsDir());
}

/** Paint a block of lines into the live PTY via a single `printf` invocation.
 *  Used by step definitions that simulate Claude prompts on screen so the
 *  server-side screen-scrape poll sees the rendered chrome. */
async function paintLinesToTerminal(
  page: KoluWorld["page"],
  lines: string[],
): Promise<void> {
  const printf = `printf '%s\\n' ${lines.map((l) => `'${l}'`).join(" ")}`;
  await page.keyboard.type(printf);
  await page.keyboard.press("Enter");
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
      `${JSON.stringify({
        type: "assistant",
        message: {
          model: "claude-opus-4-6",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "previous" }],
        },
      })}\n`,
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
    fs.writeFileSync(mockTranscriptPath, buildTranscript(state as MockState));
  },
);

When(
  "the terminal renders a Claude AskUserQuestion prompt",
  async function (this: KoluWorld) {
    // #905: an `AskUserQuestion` prompt never reaches the JSONL while it's
    // pending (the SDK buffers it), so the transcript stays `waiting`. kolu
    // recovers `awaiting_user` by scraping the *rendered screen* server-side.
    // Paint the prompt's real v2.1.162 signature — the `↑/↓ to navigate` select
    // footer — into the live PTY so the screen-scrape poll (which reads
    // `getScreenText` off the buffer) sees exactly what Claude paints.
    await paintLinesToTerminal(this.page, [
      " Which database do you prefer?",
      "",
      "❯ 1. Postgres",
      "  2. SQLite",
      "",
      " Enter to select · ↑/↓ to navigate · Esc to cancel",
    ]);
  },
);

When(
  "the terminal renders a Claude AskUserQuestion prompt with a notes hint",
  async function (this: KoluWorld) {
    // claude-code v2.1.173 added a `· n to add notes` segment to the footer,
    // landing between `to navigate` and `Esc to cancel`. The old marker required
    // those two adjacent, so the prompt stopped promoting (the dock looked idle).
    // Paint the real v2.1.173 footer so the screen scrape sees exactly what
    // Claude paints now — the awaiting promotion must still fire.
    await paintLinesToTerminal(this.page, [
      " Which package decomposition is cleanest?",
      "",
      "❯ 1. Entry with behaviour",
      "  2. Supervisor owns the entry",
      "",
      " Enter to select · ↑/↓ to navigate · n to add notes · Esc to cancel",
    ]);
  },
);

When(
  "the terminal renders a Claude permission prompt",
  async function (this: KoluWorld) {
    // A tool-permission gate (here the edit-family one) is on screen while the
    // tool call sits on disk — so the session reads as `tool_use`. Paint its real
    // v2.1.162 signature — the `Tab to amend` footer — into the live PTY.
    await paintLinesToTerminal(this.page, [
      " Do you want to create notes.txt?",
      "❯ 1. Yes",
      "  2. Yes, allow all edits during this session (shift+tab)",
      "  3. No",
      " Esc to cancel · Tab to amend",
    ]);
  },
);

When("the Claude Code session ends", async function (this: KoluWorld) {
  cleanup();
});

Then(
  "the tile chrome should show an agent indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    // Polled check with periodic mock-file re-touch — see nudgeMockFiles().
    // Same total budget as a bare waitForFunction(POLL_TIMEOUT); we just slice
    // it into ~250ms ticks and re-trigger the server's fs.watch each tick.
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

Then(
  "the tile title state pip should be {string}",
  async function (this: KoluWorld, expectedVariant: string) {
    // The shared StatePip is reused verbatim in the canvas-tile title
    // bar, so it carries the same data-testid ("state-pip") and
    // data-pip variant — scoped to the title bar here to disambiguate
    // from the dock's own pips. Polled + nudged like the agent-indicator
    // check because the variant derives from server-pushed agent state.
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile-titlebar"] [data-testid="state-pip"]',
          );
          return el?.getAttribute("data-pip") ?? null;
        }),
      isDone: (v) => v === expectedVariant,
      onTick: nudgeMockFiles,
      onTimeout: (last, elapsed) =>
        new Error(
          `Expected title state pip "${expectedVariant}", got "${last}" after ${elapsed}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should show workflow badge {string}",
  async function (this: KoluWorld, expected: string) {
    // Same polled + nudge shape as the agent-indicator check: re-touch the
    // transcript each tick so the server re-derives and re-reads the journal.
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-workflow-badge"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-workflow-badge"]',
          );
          return el?.textContent ?? null;
        }),
      isDone: (v) => v?.includes(expected) ?? false,
      onTick: nudgeMockFiles,
      onTimeout: (last, elapsed) =>
        new Error(
          `Expected workflow badge containing "${expected}", got "${last}" after ${elapsed}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should not show an agent indicator",
  async function (this: KoluWorld) {
    // Poll + nudge the SESSIONS_DIR so a dropped deletion event (darwin
    // FSEvents under load) can't wedge the indicator on stale state — see
    // nudgeSessionsDir(). Hydration budget: clearing the indicator is a
    // server re-derivation that propagates through the same fs.watch → SSE
    // chain as a fresh appearance, and under the post-koluBin-build cold-cache
    // storm that round-trip can exceed POLL_TIMEOUT even once re-fired.
    await pollFor({
      observe: () =>
        this.page.evaluate(
          () =>
            document.querySelector(
              '[data-testid="canvas-tile"] [data-testid="agent-indicator"]',
            ) === null,
        ),
      isDone: (gone) => gone === true,
      onTick: nudgeSessionsDir,
      onTimeout: (_last, elapsed) =>
        new Error(
          `Expected the tile-chrome agent indicator to disappear, but it was still present after ${elapsed}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should show task progress {string}",
  async function (this: KoluWorld, expected: string) {
    // The tasks are APPENDED to the mock transcript — a SECOND fs event after
    // the session was already set up, which is exactly the one that drops under
    // darwin FSEvents / parallel-worker pressure (see the data-then-trigger note
    // on the mock-state step). When it drops, the session watcher never re-tails
    // and the progress never appears. Poll the tile chrome while nudging the
    // transcript each tick to re-fire the dropped watch event — the same
    // recovery waitForCodeTabReady uses. HYDRATION budget: append → watch →
    // parse → metadata → tile is the slow first-appearance axis.
    await pollFor({
      observe: () =>
        this.page.evaluate(
          (txt) =>
            document
              .querySelector('[data-testid="agent-task-progress"]')
              ?.textContent?.includes(txt) ?? false,
          expected,
        ),
      isDone: (visible) => visible === true,
      onTick: () => nudgeFiles(mockTranscriptPath ? [mockTranscriptPath] : []),
      onTimeout: (_last, elapsed) =>
        new Error(
          `tile chrome never showed task progress "${expected}" within ${elapsed}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
      intervalMs: 500,
    });
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
  return `${lines.join("\n")}\n`;
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
  "the header should not show an agent indicator",
  async function (this: KoluWorld) {
    // Poll + nudge SESSIONS_DIR for the same dropped-deletion recovery and
    // hydration budget as the tile-chrome disappearance assertion above.
    await pollFor({
      observe: () =>
        this.page.evaluate(
          () =>
            document.querySelector('[data-testid="agent-indicator"]') === null,
        ),
      isDone: (gone) => gone === true,
      onTick: nudgeSessionsDir,
      onTimeout: (_last, elapsed) =>
        new Error(
          `Expected the header agent indicator to disappear, but it was still present after ${elapsed}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);
