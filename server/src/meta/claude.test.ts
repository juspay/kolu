import { describe, it, expect } from "vitest";
import { deriveState, encodeProjectPath, infoEqual } from "./claude.ts";
import type { ClaudeCodeInfo } from "kolu-common";

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

describe("infoEqual", () => {
  const info: ClaudeCodeInfo = {
    state: "thinking",
    sessionId: "abc-123",
    model: "claude-opus-4-6",
  };

  it("returns true for identical references", () => {
    expect(infoEqual(info, info)).toBe(true);
  });

  it("returns true for both null", () => {
    expect(infoEqual(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(infoEqual(info, null)).toBe(false);
    expect(infoEqual(null, info)).toBe(false);
  });

  it("returns true for equal values", () => {
    expect(infoEqual(info, { ...info })).toBe(true);
  });

  it.each([
    { field: "state", value: "waiting" },
    { field: "sessionId", value: "other" },
    { field: "model", value: "claude-sonnet-4-6" },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(infoEqual(info, { ...info, [field]: value })).toBe(false);
  });
});
