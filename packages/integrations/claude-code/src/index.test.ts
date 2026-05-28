import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deriveState,
  deriveTaskProgress,
  encodeProjectPath,
  extractTasks,
  outstandingBackgroundTasks,
  tailJsonlLines,
} from "./core.ts";

// --- Shared fixtures for dynamic-workflow background-task entries ---

/** A `user` `tool_result` confirming a background launch. Omit `runId` to
 *  model a plain background `Task`/`Agent` (no workflow journal). */
function bgLaunch(taskId: string, runId?: string): string {
  const runLine = runId ? `\nRun ID: ${runId}` : "";
  return JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: `tu-${taskId}`,
          content: `Workflow launched in background. Task ID: ${taskId}\nTranscript dir: /x/subagents/workflows/${runId ?? "none"}${runLine}`,
        },
      ],
    },
  });
}

/** A `queue-operation` enqueue carrying a terminal task-notification. */
function bgComplete(taskId: string, status = "completed"): string {
  return JSON.stringify({
    type: "queue-operation",
    operation: "enqueue",
    content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n</task-notification>`,
  });
}

const endTurn = JSON.stringify({
  type: "assistant",
  message: { stop_reason: "end_turn", model: "claude-opus-4-6" },
});

describe("deriveState", () => {
  it("returns null for empty lines", () => {
    expect(deriveState([])).toBeNull();
  });

  it.each([
    { stop_reason: "end_turn", expected: "waiting" },
    { stop_reason: "tool_use", expected: "tool_use" },
    { stop_reason: null, expected: "thinking" },
  ])("assistant with stop_reason=$stop_reason → $expected", ({
    stop_reason,
    expected,
  }) => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason, model: "claude-opus-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: expected,
      model: "claude-opus-4-6",
      contextTokens: null,
    });
  });

  it("returns awaiting_user when the only pending tool is AskUserQuestion", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        model: "claude-opus-4-7",
        content: [
          { type: "text", text: "Need a decision before I proceed." },
          { type: "tool_use", name: "AskUserQuestion", id: "tu_1" },
        ],
      },
    });
    expect(deriveState([line])).toEqual({
      state: "awaiting_user",
      model: "claude-opus-4-7",
      contextTokens: null,
    });
  });

  it("returns awaiting_user when ExitPlanMode is the only pending tool", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        model: "claude-opus-4-7",
        content: [{ type: "tool_use", name: "ExitPlanMode", id: "tu_1" }],
      },
    });
    expect(deriveState([line])).toMatchObject({ state: "awaiting_user" });
  });

  it("stays tool_use when AskUserQuestion is mixed with a real tool call", () => {
    // Mixed batch: the human-input prompt is real, but so is the Read —
    // there's compute in flight, so "Running tools" is honest.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        model: "claude-opus-4-7",
        content: [
          { type: "tool_use", name: "AskUserQuestion", id: "tu_1" },
          { type: "tool_use", name: "Read", id: "tu_2" },
        ],
      },
    });
    expect(deriveState([line])).toMatchObject({ state: "tool_use" });
  });

  it("falls back to tool_use when content is missing on a tool_use stop", () => {
    // Synthetic transcripts (e.g. `claude -c` replays) may omit content;
    // we can't tell what's pending so treat it as the conservative case.
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "tool_use", model: "claude-opus-4-7" },
    });
    expect(deriveState([line])).toMatchObject({ state: "tool_use" });
  });

  it("returns thinking for assistant with missing stop_reason", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: "claude-opus-4-6",
      contextTokens: null,
    });
  });

  it("returns thinking for user message", () => {
    const line = JSON.stringify({ type: "user" });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: null,
      contextTokens: null,
    });
  });

  it("uses last relevant message (walks backwards)", () => {
    const user = JSON.stringify({ type: "user" });
    const assistant = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", model: "claude-opus-4-6" },
    });
    expect(deriveState([user, assistant])).toEqual({
      state: "waiting",
      model: "claude-opus-4-6",
      contextTokens: null,
    });
  });

  it("skips non-user/assistant types", () => {
    const system = JSON.stringify({ type: "system" });
    const user = JSON.stringify({ type: "user" });
    expect(deriveState([user, system])).toEqual({
      state: "thinking",
      model: null,
      contextTokens: null,
    });
  });

  it("sums input + cache_creation + cache_read from assistant usage", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 6,
          cache_creation_input_tokens: 810,
          cache_read_input_tokens: 28663,
          output_tokens: 380,
        },
      },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: "claude-opus-4-7",
      contextTokens: 29479,
    });
  });

  it("keeps last-assistant contextTokens sticky when user entry is newest", () => {
    // Thinking state: user just submitted a prompt, so `user` is newer than
    // the previous assistant's reply. State should come from the user entry
    // (thinking), but contextTokens must be preserved from the prior turn's
    // usage — otherwise the token count blanks out mid-conversation.
    const assistant = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 5,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 29_000,
        },
      },
    });
    const user = JSON.stringify({ type: "user" });
    expect(deriveState([assistant, user])).toEqual({
      state: "thinking",
      model: null,
      contextTokens: 29_105,
    });
  });

  it("returns null contextTokens when usage has no input-side fields", () => {
    // `claude -c` session restore can write synthetic assistant entries
    // whose `usage` block lacks all three input-side counters (only
    // `output_tokens`, or fully empty). Treat that as absent telemetry so
    // the UI hides the badge — rendering 0K would flash during restore
    // before the first real API reply lands.
    const line = JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        model: "claude-opus-4-7",
        usage: { output_tokens: 0 },
      },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: "claude-opus-4-7",
      contextTokens: null,
    });
  });

  it("tolerates missing usage fields (treats absent as zero)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: { cache_read_input_tokens: 27871 },
      },
    });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: "claude-opus-4-7",
      contextTokens: 27871,
    });
  });

  it("skips malformed JSON lines", () => {
    const valid = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", model: "claude-opus-4-6" },
    });
    expect(deriveState(["not json", valid])).toEqual({
      state: "waiting",
      model: "claude-opus-4-6",
      contextTokens: null,
    });
  });

  it("returns null when only malformed lines", () => {
    expect(deriveState(["bad", "also bad"])).toBeNull();
  });

  it("returns model null when assistant message has no model", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn" },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: null,
      contextTokens: null,
    });
  });

  // --- Dynamic-workflow: running_background promotion ---

  it("promotes end_turn to running_background when a launched task is outstanding", () => {
    // The agent yielded its turn (end_turn) but a background workflow it
    // launched has no completion yet — it is busy-waiting, not awaiting user.
    expect(deriveState([bgLaunch("t1", "wf_1"), endTurn])).toMatchObject({
      state: "running_background",
    });
  });

  it("stays waiting once the outstanding task reports a terminal status", () => {
    expect(
      deriveState([bgLaunch("t1", "wf_1"), bgComplete("t1"), endTurn]),
    ).toMatchObject({ state: "waiting" });
  });

  it("stays waiting on end_turn with no background task", () => {
    expect(deriveState([endTurn])).toMatchObject({ state: "waiting" });
  });

  it("does not promote a tool_use turn even with an outstanding task", () => {
    // tool_use already reads as working; only the bare end_turn was the
    // misclassified case.
    const toolUse = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "tool_use", model: "claude-opus-4-6" },
    });
    expect(deriveState([bgLaunch("t1", "wf_1"), toolUse])).toMatchObject({
      state: "tool_use",
    });
  });

  it("honors a precomputed outstanding set passed by the caller", () => {
    expect(
      deriveState([endTurn], [{ taskId: "t1", runId: "wf_1" }]),
    ).toMatchObject({ state: "running_background" });
  });

  it("ignores unknown/new entry types and reads state from the assistant turn", () => {
    // Entry types introduced alongside dynamic workflows must not crash the
    // parser or shift classification.
    const noise = [
      JSON.stringify({ type: "mode", mode: "normal" }),
      JSON.stringify({ type: "permission-mode", permissionMode: "default" }),
      JSON.stringify({ type: "last-prompt", lastPrompt: "hi" }),
      JSON.stringify({ type: "attachment" }),
      JSON.stringify({ type: "file-history-snapshot" }),
    ];
    expect(deriveState([...noise, endTurn, ...noise])).toMatchObject({
      state: "waiting",
      model: "claude-opus-4-6",
    });
  });
});

describe("outstandingBackgroundTasks", () => {
  it("captures task ID and workflow run ID from a launch confirmation", () => {
    expect(outstandingBackgroundTasks([bgLaunch("t1", "wf_1")])).toEqual([
      { taskId: "t1", runId: "wf_1" },
    ]);
  });

  it("reports runId null for a plain background task (no Run ID line)", () => {
    expect(outstandingBackgroundTasks([bgLaunch("t1")])).toEqual([
      { taskId: "t1", runId: null },
    ]);
  });

  it("drops a task once a terminal-status notification arrives", () => {
    expect(
      outstandingBackgroundTasks([bgLaunch("t1", "wf_1"), bgComplete("t1")]),
    ).toEqual([]);
  });

  it.each(["failed", "stopped"])("treats %s as a terminal status", (status) => {
    expect(
      outstandingBackgroundTasks([
        bgLaunch("t1", "wf_1"),
        bgComplete("t1", status),
      ]),
    ).toEqual([]);
  });

  it("keeps a task outstanding when the notification is non-terminal", () => {
    expect(
      outstandingBackgroundTasks([
        bgLaunch("t1", "wf_1"),
        bgComplete("t1", "running"),
      ]),
    ).toEqual([{ taskId: "t1", runId: "wf_1" }]);
  });

  it("ignores queue-operation dequeue entries", () => {
    const dequeue = JSON.stringify({
      type: "queue-operation",
      operation: "dequeue",
    });
    expect(
      outstandingBackgroundTasks([bgLaunch("t1", "wf_1"), dequeue]),
    ).toEqual([{ taskId: "t1", runId: "wf_1" }]);
  });

  it("tracks multiple tasks independently", () => {
    expect(
      outstandingBackgroundTasks([
        bgLaunch("t1", "wf_1"),
        bgLaunch("t2", "wf_2"),
        bgComplete("t1"),
      ]),
    ).toEqual([{ taskId: "t2", runId: "wf_2" }]);
  });
});

describe("encodeProjectPath", () => {
  it.each([
    { input: "/home/user/project.name", expected: "-home-user-project-name" },
    { input: "/", expected: "-" },
    { input: "simple", expected: "simple" },
  ])("encodeProjectPath($input) → $expected", ({ input, expected }) => {
    expect(encodeProjectPath(input)).toBe(expected);
  });
});

describe("tailJsonlLines", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-tail-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads all lines from a small file", () => {
    const filePath = path.join(tmpDir, "small.jsonl");
    const lines = [
      JSON.stringify({ type: "user" }),
      JSON.stringify({
        type: "assistant",
        message: { stop_reason: "end_turn" },
      }),
    ];
    fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
    const result = tailJsonlLines(filePath, 16_384);
    expect(result).toEqual(lines);
  });

  it("skips partial first line when reading from middle of file", () => {
    const filePath = path.join(tmpDir, "large.jsonl");
    const longLine = JSON.stringify({ type: "system", data: "x".repeat(200) });
    const lastLine = JSON.stringify({ type: "user" });
    fs.writeFileSync(filePath, `${longLine}\n${lastLine}\n`);
    const result = tailJsonlLines(filePath, 50);
    expect(result).toEqual([lastLine]);
  });

  it("returns empty array for nonexistent file", () => {
    expect(tailJsonlLines(path.join(tmpDir, "nope.jsonl"), 1024)).toEqual([]);
  });

  it("returns empty array for empty file", () => {
    const filePath = path.join(tmpDir, "empty.jsonl");
    fs.writeFileSync(filePath, "");
    expect(tailJsonlLines(filePath, 1024)).toEqual([]);
  });

  it("handles file with no trailing newline", () => {
    const filePath = path.join(tmpDir, "no-newline.jsonl");
    const line = JSON.stringify({ type: "user" });
    fs.writeFileSync(filePath, line);
    const result = tailJsonlLines(filePath, 16_384);
    expect(result).toEqual([line]);
  });
});

describe("findTranscriptPath", () => {
  let tmpDir: string;
  let findTranscriptPathFn: typeof import("./index.ts").findTranscriptPath;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-find-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    findTranscriptPathFn = mod.findTranscriptPath;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns exact match by session ID", () => {
    const cwd = "/home/user/myproject";
    const sessionId = "test-session-123";
    const projectDir = path.join(tmpDir, encodeProjectPath(cwd));
    fs.mkdirSync(projectDir, { recursive: true });
    const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
    fs.writeFileSync(transcriptPath, `${JSON.stringify({ type: "user" })}\n`);

    const result = findTranscriptPathFn({ pid: 1, sessionId, cwd });
    expect(result).toBe(transcriptPath);
  });

  it("returns null when session JSONL doesn't exist, ignoring other files in dir", () => {
    const cwd = "/home/user/multi-session-project";
    const projectDir = path.join(tmpDir, encodeProjectPath(cwd));
    fs.mkdirSync(projectDir, { recursive: true });

    const otherPath = path.join(projectDir, "other-session.jsonl");
    fs.writeFileSync(otherPath, `${JSON.stringify({ type: "user" })}\n`);

    const result = findTranscriptPathFn({
      pid: 1,
      sessionId: "current-session-id",
      cwd,
    });
    expect(result).toBeNull();
  });

  it("returns null when project dir does not exist", () => {
    const result = findTranscriptPathFn({
      pid: 1,
      sessionId: "any",
      cwd: "/nonexistent/path",
    });
    expect(result).toBeNull();
  });
});

describe("extractTasks", () => {
  const mockLog = { error: vi.fn() };

  function taskCreateResult(id: string, subject: string): string {
    return JSON.stringify({
      type: "user",
      uuid: `u-${id}`,
      timestamp: new Date().toISOString(),
      message: { role: "user", content: [] },
      toolUseResult: { task: { id, subject } },
    });
  }

  function taskUpdate(taskId: string, status: string): string {
    return JSON.stringify({
      type: "assistant",
      uuid: `a-${taskId}-${status}`,
      timestamp: new Date().toISOString(),
      message: {
        model: "claude-opus-4-6",
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: `tool-${taskId}`,
            name: "TaskUpdate",
            input: { taskId, status },
          },
        ],
      },
    });
  }

  it("extracts tasks from TaskCreate results", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    const lines = [
      taskCreateResult("1", "Task one"),
      taskCreateResult("2", "Task two"),
    ];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(true);
    expect(tasks.size).toBe(2);
    expect(tasks.get("1")).toBe("pending");
    expect(tasks.get("2")).toBe("pending");
  });

  it("updates task status from TaskUpdate calls", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    tasks.set("1", "pending");
    const lines = [taskUpdate("1", "in_progress")];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(true);
    expect(tasks.get("1")).toBe("in_progress");
  });

  it("handles TaskUpdate with deleted status", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    tasks.set("1", "pending");
    const lines = [taskUpdate("1", "deleted")];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(true);
    expect(tasks.has("1")).toBe(false);
  });

  it("returns false when nothing changed", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    tasks.set("1", "completed");
    const lines = [taskUpdate("1", "completed")];
    const changed = extractTasks(lines, tasks, mockLog);
    expect(changed).toBe(false);
  });

  it("warns on unexpected TaskUpdate input shape", () => {
    mockLog.error.mockClear();
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "TaskUpdate", input: { bad: true } },
        ],
      },
    });
    extractTasks([line], tasks, mockLog);
    expect(mockLog.error).toHaveBeenCalled();
  });

  it("ignores non-task tool calls", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">();
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", name: "Read", input: { path: "/foo" } }],
      },
    });
    const changed = extractTasks([line], tasks, mockLog);
    expect(changed).toBe(false);
    expect(tasks.size).toBe(0);
  });
});

describe("deriveTaskProgress", () => {
  it("returns null for empty map", () => {
    expect(deriveTaskProgress(new Map())).toBeNull();
  });

  it("returns correct counts", () => {
    const tasks = new Map<string, "pending" | "in_progress" | "completed">([
      ["1", "completed"],
      ["2", "in_progress"],
      ["3", "completed"],
      ["4", "pending"],
    ]);
    expect(deriveTaskProgress(tasks)).toEqual({ total: 4, completed: 2 });
  });
});

describe("deriveWorkflowProgress", () => {
  let tmpDir: string;
  let deriveWorkflowProgressFn: typeof import("./index.ts").deriveWorkflowProgress;
  const cwd = "/home/user/project";
  const sessionId = "sess-1";

  function writeJournal(runId: string, body: Record<string, unknown>): void {
    const dir = path.join(
      tmpDir,
      encodeProjectPath(cwd),
      sessionId,
      "workflows",
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${runId}.json`), JSON.stringify(body));
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-wf-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./index.ts");
    deriveWorkflowProgressFn = mod.deriveWorkflowProgress;
  });

  afterAll(() => {
    delete process.env.KOLU_CLAUDE_PROJECTS_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const session = () => ({ pid: 1, sessionId, cwd });

  it("reads name, status, and agent count from the run journal", () => {
    writeJournal("wf_run", {
      workflowName: "deep-research",
      status: "running",
      agentCount: 12,
    });
    expect(
      deriveWorkflowProgressFn(session(), [{ taskId: "t1", runId: "wf_run" }]),
    ).toEqual({ name: "deep-research", status: "running", agents: 12 });
  });

  it("returns null for a task with no run ID (plain background task)", () => {
    expect(
      deriveWorkflowProgressFn(session(), [{ taskId: "t1", runId: null }]),
    ).toBeNull();
  });

  it("returns null when the journal file is missing", () => {
    expect(
      deriveWorkflowProgressFn(session(), [
        { taskId: "t1", runId: "wf_absent" },
      ]),
    ).toBeNull();
  });

  it("prefers a running journal over a completed one", () => {
    writeJournal("wf_done", {
      workflowName: "a",
      status: "completed",
      agentCount: 3,
    });
    writeJournal("wf_live", {
      workflowName: "b",
      status: "running",
      agentCount: 7,
    });
    expect(
      deriveWorkflowProgressFn(session(), [
        { taskId: "t1", runId: "wf_done" },
        { taskId: "t2", runId: "wf_live" },
      ]),
    ).toMatchObject({ name: "b", status: "running" });
  });
});
