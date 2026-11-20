import * as assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import {
  ACTIVE_TERMINAL,
  readBufferText,
  waitForBufferContains,
} from "../support/buffer.ts";
import { nudgeDir, nudgeFiles } from "../support/nudge.ts";
import { pollFor } from "../support/poll.ts";
import { redeployUnderThisPage } from "../support/redeploy.ts";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

export const SESSION_ID = "test-claude-session-00000000-0000-0000-0000";
const WORKFLOW_TASK_ID = "task-bg-0000";
const WORKFLOW_RUN_ID = "wf-test-run-0000";
const WORKFLOW_NAME = "deep-research";
const WORKFLOW_AGENTS = 5;

type MockState =
  | "thinking"
  | "thinking_after_reply"
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

const FORK_SUBAGENT_ID = "aimplement-it-test00000000000000";
const getSessionsDir = () => process.env.KOLU_CLAUDE_SESSIONS_DIR;
const getProjectsDir = () => process.env.KOLU_CLAUDE_PROJECTS_DIR;

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

const userTextMsg = (uuid: string, text: string) =>
  JSON.stringify({
    type: "user",
    uuid,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text }] },
  });

const userStringMsg = (
  uuid: string,
  content: string,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    type: "user",
    uuid,
    ...extra,
    timestamp: new Date().toISOString(),
    message: { role: "user", content },
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

const assistantToolUseMsg = (toolUseId: string, name: string) =>
  JSON.stringify({
    type: "assistant",
    uuid: "a1",
    timestamp: new Date().toISOString(),
    message: {
      model: "claude-opus-4-6",
      role: "assistant",
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: toolUseId, name, input: {} }],
    },
  });

const toolResultMsg = (
  uuid: string,
  toolUseId: string,
  content: string,
  isError = false,
) =>
  JSON.stringify({
    type: "user",
    uuid,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          ...(isError ? { is_error: true } : {}),
          content,
        },
      ],
    },
  });

const thinkingTail = (): string[] => [];

const thinkingAfterReplyTail = (): string[] => [
  assistantMsg("end_turn"),
  userTextMsg("u2", "carry on"),
];

const toolUseTail = (): string[] => [assistantMsg("tool_use")];

const waitingTail = (): string[] => [assistantMsg("end_turn")];

const awaitingUserTail = (): string[] => [
  assistantToolUseMsg("tu-ask", "AskUserQuestion"),
];

const backgroundWorkflowTail = (): string[] => [
  toolResultMsg(
    "u2",
    "tu-bg",
    `Workflow launched in background. Task ID: ${WORKFLOW_TASK_ID}\nRun ID: ${WORKFLOW_RUN_ID}`,
  ),
  assistantMsg("end_turn"),
];

const backgroundBashTail = (): string[] => [
  toolResultMsg(
    "u2",
    "tu-bash",
    "Command running in background with ID: bg-bash-0000. Output is being written to: /tmp/bg-bash-0000.output.",
  ),
  assistantMsg("end_turn"),
];

const forkTail = (): string[] => [
  assistantMsg("end_turn"),
  JSON.stringify({
    type: "system",
    subtype: "local_command",
    uuid: "u2",
    timestamp: new Date().toISOString(),
    content:
      "<local-command-stdout>⑂ forked implement-it (1483)</local-command-stdout>",
    level: "info",
  }),
];

const interruptedTail = (): string[] => [
  userTextMsg("u2", "[Request interrupted by user]"),
];

const interruptedToolUseTail = (): string[] => [
  toolResultMsg(
    "u2",
    "tu-int",
    "The user doesn't want to proceed with this tool use. The tool use was rejected.",
    true,
  ),
  userTextMsg("u3", "[Request interrupted by user for tool use]"),
];

const compactTail = (): string[] => [
  assistantMsg("end_turn"),
  userStringMsg("u2", "This session is being continued from a previous…", {
    isCompactSummary: true,
  }),
  userStringMsg(
    "u3",
    "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>",
  ),
  userStringMsg(
    "u4",
    "<command-name>/compact</command-name>\n            <command-message>compact</command-message>\n            <command-args></command-args>",
  ),
  userStringMsg(
    "u5",
    "<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>",
  ),
];

const TRANSCRIPT_TAILS: Record<MockState, () => string[]> = {
  thinking: thinkingTail,
  thinking_after_reply: thinkingAfterReplyTail,
  tool_use: toolUseTail,
  waiting: waitingTail,
  awaiting_user: awaitingUserTail,
  running_background: backgroundWorkflowTail,
  orphaned_workflow: backgroundWorkflowTail,
  journalless_workflow: backgroundWorkflowTail,
  background_bash: backgroundBashTail,
  fork: forkTail,
  interrupted: interruptedTail,
  interrupted_tool_use: interruptedToolUseTail,
  compact: compactTail,
};

export function buildTranscript(state: MockState): string {
  const lines = [userTextMsg("u1", "hello"), ...TRANSCRIPT_TAILS[state]()];
  return `${lines.join("\n")}\n`;
}

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
    const old = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(journalPath, old, old);
  }
}

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

let mockCwd: string | null = null;

let mockSessionFile: string | null = null;
let mockProjectDir: string | null = null;
let mockTranscriptPath: string | null = null;
let mockScratchDir: string | null = null;
let mockAgentPid: number | null = null;
let mockStagePath: string | null = null;
let promptCounter = 0;

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
  if (mockScratchDir && fs.existsSync(mockScratchDir)) {
    fs.rmSync(mockScratchDir, { recursive: true, force: true });
  }
  mockScratchDir = null;
  mockStagePath = null;
  mockAgentPid = null;
}

After(() => {
  cleanup();
});

const HEARD_HALVES = ["claude-stand-in", "-heard"] as const;
const CLAUDE_HEARD_MARKER = HEARD_HALVES.join("");

const writeSessionFile = (sessionsDir: string, cwd: string): string =>
  [
    `mkdir -p "${sessionsDir}"`,
    [
      String.raw`printf "{\"pid\":%s,\"sessionId\":\"%s\",\"cwd\":\"%s\",\"startedAt\":%s}\n"`,
      `"$$" "${SESSION_ID}" "${cwd}" "$(date +%s)000"`,
      `> "${sessionsDir}/$$.json"`,
    ].join(" "),
  ].join(" ; ");

const promptLoop = (opts: {
  transcriptPath: string;
  stagePath: string;
}): string => {
  const assembleHeard = `h="${HEARD_HALVES[0]}"; h="$h""${HEARD_HALVES[1]}"`;
  const stripPaint = "line=$" + `{ccline#"paint "}`;
  const onPrompt = [
    `if [ -f "${opts.stagePath}" ]`,
    `then cat "${opts.stagePath}" >> "${opts.transcriptPath}"`,
    `rm -f "${opts.stagePath}"`,
    "fi",
    String.raw`printf "%s %s\n" "$h" "$ccline"`,
  ].join("; ");
  const cases = [
    `"paint "*) ${stripPaint}; printf "%s\\n" "$line" ;;`,
    "quit) break ;;",
    `*) ${onPrompt} ;;`,
  ].join(" ");
  return [
    `mkdir -p "${path.dirname(opts.transcriptPath)}"`,
    assembleHeard,
    `while IFS= read -r ccline; do case "$ccline" in ${cases} esac; done`,
  ].join(" ; ");
};

function claudeMockPayload(opts: {
  sessionsDir: string;
  cwd: string;
  pidMarker: string;
  transcriptPath: string;
  stagePath: string;
}): string {
  const writePidMarker = `echo $$ > "${opts.pidMarker}"`;
  return [
    String.raw`printf "\033]0;claude\007"`,
    writeSessionFile(opts.sessionsDir, opts.cwd),
    writePidMarker,
    promptLoop(opts),
    ":",
  ].join(" ; ");
}

function writeFoundClaudeSession(
  pid: number,
  cwd: string,
  state: MockState,
): void {
  const sessionsDir = getSessionsDir();
  const projectsDir = getProjectsDir();
  if (!sessionsDir || !projectsDir) {
    throw new Error(
      "KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR must be set",
    );
  }
  mockCwd = cwd;
  fs.mkdirSync(projectsDir, { recursive: true });
  mockProjectDir = path.join(projectsDir, cwd.replace(/[/.]/g, "-"));
  fs.mkdirSync(mockProjectDir, { recursive: true });
  mockTranscriptPath = path.join(mockProjectDir, `${SESSION_ID}.jsonl`);
  fs.writeFileSync(mockTranscriptPath, buildTranscript(state));
  fs.mkdirSync(sessionsDir, { recursive: true });
  mockSessionFile = path.join(sessionsDir, `${pid}.json`);
  fs.writeFileSync(
    mockSessionFile,
    JSON.stringify({ pid, sessionId: SESSION_ID, cwd, startedAt: Date.now() }),
  );
}

function stageClaudePrompt(state: MockState): void {
  if (!mockStagePath || !mockProjectDir) {
    throw new Error("No Claude stand-in is running — start one first");
  }
  fs.writeFileSync(mockStagePath, buildTranscript(state));
  if (state === "running_background") writeWorkflowJournal(mockProjectDir);
  if (state === "orphaned_workflow")
    writeWorkflowJournal(mockProjectDir, { stale: true });
  if (state === "fork") writeForkSubagent(mockProjectDir);
}

async function startFakeClaude(world: KoluWorld, args = ""): Promise<void> {
  const bin = process.env.KOLU_FAKE_CLAUDE_BIN;
  if (!bin) throw new Error("KOLU_FAKE_CLAUDE_BIN must be set");
  const sessionsDir = getSessionsDir();
  const projectsDir = getProjectsDir();
  if (!sessionsDir || !projectsDir) {
    throw new Error(
      "KOLU_CLAUDE_SESSIONS_DIR and KOLU_CLAUDE_PROJECTS_DIR must be set",
    );
  }
  cleanup();
  const cwd = `/tmp/claude-test-${process.pid}-${Date.now()}`;
  mockCwd = cwd;
  fs.mkdirSync(projectsDir, { recursive: true });
  mockProjectDir = path.join(projectsDir, cwd.replace(/[/.]/g, "-"));
  fs.mkdirSync(mockProjectDir, { recursive: true });
  mockTranscriptPath = path.join(mockProjectDir, `${SESSION_ID}.jsonl`);
  mockScratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolu-claude-agent-"));
  const marker = path.join(mockScratchDir, "pid");
  mockStagePath = path.join(mockScratchDir, "stage");

  const payload = claudeMockPayload({
    sessionsDir,
    cwd,
    pidMarker: marker,
    transcriptPath: mockTranscriptPath,
    stagePath: mockStagePath,
  });
  await world.page.keyboard.type(
    `${bin} -c '${payload}'${args === "" ? "" : ` ${args}`}`,
  );
  await world.page.keyboard.press("Enter");

  const agentPid = await pollFor({
    observe: async () =>
      fs.existsSync(marker)
        ? Number(fs.readFileSync(marker, "utf8").trim())
        : null,
    isDone: (pid) => pid !== null && Number.isFinite(pid) && pid > 0,
    onTimeout: (_, ms) =>
      new Error(`fake claude agent never reported its pid within ${ms}ms`),
    timeoutMs: POLL_TIMEOUT,
  }).catch(async (err: Error) => {
    const buffer = await readBufferText(world.page);
    throw new Error(`${err.message}\n— terminal tail:\n${buffer.slice(-600)}`);
  });
  if (agentPid === null) throw new Error("fake claude agent pid missing");
  mockAgentPid = agentPid;
  mockSessionFile = path.join(sessionsDir, `${agentPid}.json`);
}

async function promptFakeClaude(world: KoluWorld): Promise<void> {
  promptCounter += 1;
  const words = `fix the parser ${promptCounter}`;
  await world.page.keyboard.type(words);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, `${CLAUDE_HEARD_MARKER} ${words}`);
}

When(
  "a Claude Code session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await startFakeClaude(this);
    stageClaudePrompt(state as MockState);
    await promptFakeClaude(this);
  },
);

When("I note the terminal's shell pid", async function (this: KoluWorld) {
  this.notedShellPid = await getTerminalPid(this);
});

When(
  "a Claude Code session is mocked with state {string} on the noted terminal",
  async function (this: KoluWorld, state: string) {
    const pid = this.notedShellPid;
    if (pid === undefined) throw new Error("no terminal's shell pid was noted");
    cleanup();
    writeFoundClaudeSession(
      pid,
      `/tmp/claude-test-${pid}-${Date.now()}`,
      state as MockState,
    );
  },
);

When(
  "a fake Claude Code agent is running with the arguments {string}",
  async function (this: KoluWorld, args: string) {
    await startFakeClaude(this, args);
    stageClaudePrompt("thinking");
    await promptFakeClaude(this);

    try {
      await pollFor({
        observe: () =>
          this.page.evaluate(
            () =>
              document
                .querySelector(
                  '[data-testid="canvas-tile"] [data-testid="agent-indicator"]',
                )
                ?.getAttribute("data-agent-kind") ?? null,
          ),
        isDone: (kind) => kind === "claude-code",
        onTimeout: (last, ms) =>
          new Error(
            `fake claude agent was never detected (kind=${last ?? "null"}) within ${ms}ms`,
          ),
        timeoutMs: POLL_TIMEOUT,
      });
    } catch (err) {
      const buffer = await readBufferText(this.page);
      throw new Error(
        `${(err as Error).message}\n— terminal tail:\n${buffer.slice(-600)}`,
      );
    }
  },
);

function refireTranscriptWatch() {
  nudgeFiles([mockSessionFile, mockTranscriptPath]);
  nudgeDir(getSessionsDir());
}

function refireSessionsDirWatch() {
  nudgeDir(getSessionsDir());
}

async function paintLinesToTerminal(
  page: KoluWorld["page"],
  lines: string[],
): Promise<void> {
  for (const line of lines) {
    await page.keyboard.type(`paint ${line}`);
    await page.keyboard.press("Enter");
  }
}

When(
  "a newer stale previous-session JSONL exists in the same project dir",
  async function (this: KoluWorld) {
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
  "the kolu server is redeployed while the Claude Code session changes to {string}",
  { timeout: 180_000 },
  async function (this: KoluWorld, state: string) {
    const transcript = mockTranscriptPath;
    if (!transcript) throw new Error("No mock transcript to update");
    await redeployUnderThisPage(this, () =>
      fs.writeFileSync(transcript, buildTranscript(state as MockState)),
    );
  },
);

When(
  "the terminal renders a Claude AskUserQuestion prompt",
  async function (this: KoluWorld) {
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
  const pid = mockAgentPid;
  if (pid !== null) {
    await this.page.keyboard.type("quit");
    await this.page.keyboard.press("Enter");
    await pollFor({
      observe: async () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      },
      isDone: (alive) => alive === false,
      onTimeout: (_last, ms) =>
        new Error(`the fake claude (pid ${pid}) was still alive after ${ms}ms`),
      timeoutMs: POLL_TIMEOUT,
    });
  }
  cleanup();
});

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
      onTick: refireTranscriptWatch,
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
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile-titlebar"] [data-testid="state-pip"]',
          );
          return el?.getAttribute("data-pip") ?? null;
        }),
      isDone: (v) => v === expectedVariant,
      onTick: refireTranscriptWatch,
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
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-workflow-badge"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-workflow-badge"]',
          );
          return el?.textContent ?? null;
        }),
      isDone: (v) => v?.includes(expected) ?? false,
      onTick: refireTranscriptWatch,
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
    await pollFor({
      observe: () =>
        this.page.evaluate(
          () =>
            document.querySelector(
              '[data-testid="canvas-tile"] [data-testid="agent-indicator"]',
            ) === null,
        ),
      isDone: (gone) => gone === true,
      onTick: refireSessionsDirWatch,
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

function buildTaskLines(
  tasks: Array<{ id: string; subject: string; status: string }>,
): string {
  const lines: string[] = [];
  for (const task of tasks) {
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
    fs.appendFileSync(mockTranscriptPath, buildTaskLines(tasks));
  },
);

Then(
  "the header should not show an agent indicator",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () =>
        this.page.evaluate(
          () =>
            document.querySelector('[data-testid="agent-indicator"]') === null,
        ),
      isDone: (gone) => gone === true,
      onTick: refireSessionsDirWatch,
      onTimeout: (_last, elapsed) =>
        new Error(
          `Expected the header agent indicator to disappear, but it was still present after ${elapsed}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);
