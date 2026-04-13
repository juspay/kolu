import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  deriveState,
  deriveTaskProgress,
  encodeProjectPath,
  extractTasks,
  readJsonlFromOffset,
  tailJsonlLines,
} from "./index.ts";

describe("deriveState", () => {
  it("returns null for empty lines", () => {
    expect(deriveState([])).toBeNull();
  });

  it.each([
    { stop_reason: "end_turn", expected: "waiting" },
    { stop_reason: "tool_use", expected: "tool_use" },
    { stop_reason: null, expected: "thinking" },
  ])(
    "assistant with stop_reason=$stop_reason → $expected",
    ({ stop_reason, expected }) => {
      const line = JSON.stringify({
        type: "assistant",
        message: { stop_reason, model: "claude-opus-4-6" },
      });
      expect(deriveState([line])).toEqual({
        state: expected,
        model: "claude-opus-4-6",
      });
    },
  );

  it("returns thinking for assistant with missing stop_reason", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: "claude-opus-4-6",
    });
  });

  it("returns thinking for user message", () => {
    const line = JSON.stringify({ type: "user" });
    expect(deriveState([line])).toEqual({ state: "thinking", model: null });
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
    });
  });

  it("skips non-user/assistant types", () => {
    const system = JSON.stringify({ type: "system" });
    const user = JSON.stringify({ type: "user" });
    expect(deriveState([user, system])).toEqual({
      state: "thinking",
      model: null,
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
    expect(deriveState([line])).toEqual({ state: "waiting", model: null });
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
    fs.writeFileSync(filePath, lines.join("\n") + "\n");
    const result = tailJsonlLines(filePath, 16_384);
    expect(result).toEqual(lines);
  });

  it("skips partial first line when reading from middle of file", () => {
    const filePath = path.join(tmpDir, "large.jsonl");
    const longLine = JSON.stringify({ type: "system", data: "x".repeat(200) });
    const lastLine = JSON.stringify({ type: "user" });
    fs.writeFileSync(filePath, longLine + "\n" + lastLine + "\n");
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

describe("readJsonlFromOffset", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-offset-test-"));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns events appended after the offset", () => {
    const filePath = path.join(tmpDir, "appended.jsonl");
    const before = JSON.stringify({ type: "user", before: true });
    fs.writeFileSync(filePath, before + "\n");
    const offset = fs.statSync(filePath).size;
    const after1 = JSON.stringify({ type: "assistant", after: 1 });
    const after2 = JSON.stringify({ type: "user", after: 2 });
    fs.appendFileSync(filePath, after1 + "\n" + after2 + "\n");
    expect(readJsonlFromOffset(filePath, offset)).toEqual([
      { type: "assistant", after: 1 },
      { type: "user", after: 2 },
    ]);
  });

  it("returns empty when offset equals file size", () => {
    const filePath = path.join(tmpDir, "noop.jsonl");
    fs.writeFileSync(filePath, JSON.stringify({ type: "user" }) + "\n");
    const offset = fs.statSync(filePath).size;
    expect(readJsonlFromOffset(filePath, offset)).toEqual([]);
  });

  it("wraps unparseable lines in __unparsed", () => {
    const filePath = path.join(tmpDir, "bad.jsonl");
    fs.writeFileSync(filePath, "not-json\n");
    expect(readJsonlFromOffset(filePath, 0)).toEqual([
      { __unparsed: "not-json" },
    ]);
  });

  it("returns empty array for nonexistent file", () => {
    expect(readJsonlFromOffset(path.join(tmpDir, "nope.jsonl"), 0)).toEqual([]);
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
    fs.writeFileSync(transcriptPath, JSON.stringify({ type: "user" }) + "\n");

    const result = findTranscriptPathFn({ pid: 1, sessionId, cwd });
    expect(result).toBe(transcriptPath);
  });

  it("returns null when session JSONL doesn't exist, ignoring other files in dir", () => {
    const cwd = "/home/user/multi-session-project";
    const projectDir = path.join(tmpDir, encodeProjectPath(cwd));
    fs.mkdirSync(projectDir, { recursive: true });

    const otherPath = path.join(projectDir, "other-session.jsonl");
    fs.writeFileSync(otherPath, JSON.stringify({ type: "user" }) + "\n");

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
