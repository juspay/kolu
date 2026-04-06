import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  deriveState,
  encodeProjectPath,
  agentInfoEqual,
  tailJsonlLines,
} from "./claude.ts";
import type { AgentInfo } from "kolu-common";

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

describe("agentInfoEqual", () => {
  const info: AgentInfo = {
    kind: "claude-code",
    state: "thinking",
    sessionId: "abc-123",
    model: "claude-opus-4-6",
  };

  it("returns true for identical references", () => {
    expect(agentInfoEqual(info, info)).toBe(true);
  });

  it("returns true for both null", () => {
    expect(agentInfoEqual(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(agentInfoEqual(info, null)).toBe(false);
    expect(agentInfoEqual(null, info)).toBe(false);
  });

  it("returns true for equal values", () => {
    expect(agentInfoEqual(info, { ...info })).toBe(true);
  });

  it.each([
    { field: "state", value: "waiting" },
    { field: "sessionId", value: "other" },
    { field: "model", value: "claude-sonnet-4-6" },
    { field: "kind", value: "opencode" },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(agentInfoEqual(info, { ...info, [field]: value } as AgentInfo)).toBe(
      false,
    );
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
    // Write enough data so that reading last N bytes starts mid-line
    const longLine = JSON.stringify({ type: "system", data: "x".repeat(200) });
    const lastLine = JSON.stringify({ type: "user" });
    fs.writeFileSync(filePath, longLine + "\n" + lastLine + "\n");
    // Read only last 50 bytes — will start mid-way through longLine
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
  let findTranscriptPath: (typeof import("./claude.ts"))["findTranscriptPath"];

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-find-test-"));
    process.env.KOLU_CLAUDE_PROJECTS_DIR = tmpDir;
    vi.resetModules();
    const mod = await import("./claude.ts");
    findTranscriptPath = mod.findTranscriptPath;
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

    const result = findTranscriptPath({ pid: 1, sessionId, cwd });
    expect(result).toBe(transcriptPath);
  });

  it("falls back to most recently modified JSONL", () => {
    const cwd = "/home/user/fallback-project";
    const projectDir = path.join(tmpDir, encodeProjectPath(cwd));
    fs.mkdirSync(projectDir, { recursive: true });

    // Write a JSONL with a different session ID but recent mtime
    const otherPath = path.join(projectDir, "other-session.jsonl");
    fs.writeFileSync(otherPath, JSON.stringify({ type: "user" }) + "\n");
    // Touch it to ensure it's recent
    fs.utimesSync(otherPath, new Date(), new Date());

    const result = findTranscriptPath({
      pid: 1,
      sessionId: "nonexistent-id",
      cwd,
    });
    expect(result).toBe(otherPath);
  });

  it("returns null when project dir does not exist", () => {
    const result = findTranscriptPath({
      pid: 1,
      sessionId: "any",
      cwd: "/nonexistent/path",
    });
    expect(result).toBeNull();
  });

  it("returns null when MRU file is stale", () => {
    const cwd = "/home/user/stale-project";
    const projectDir = path.join(tmpDir, encodeProjectPath(cwd));
    fs.mkdirSync(projectDir, { recursive: true });

    const stalePath = path.join(projectDir, "stale.jsonl");
    fs.writeFileSync(stalePath, JSON.stringify({ type: "user" }) + "\n");
    // Set mtime to 10 seconds ago (beyond default 6s threshold)
    const staleTime = new Date(Date.now() - 10_000);
    fs.utimesSync(stalePath, staleTime, staleTime);

    const result = findTranscriptPath({
      pid: 1,
      sessionId: "nonexistent",
      cwd,
    });
    expect(result).toBeNull();
  });
});
