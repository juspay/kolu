import { describe, it, expect } from "vitest";
import { deriveState, encodeProjectPath, infoEqual } from "./claude.ts";
import type { ClaudeCodeInfo } from "kolu-common";

describe("deriveState", () => {
  it("returns null for empty lines", () => {
    expect(deriveState([])).toBeNull();
  });

  it("returns waiting for assistant with end_turn", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn", model: "claude-opus-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: "waiting",
      model: "claude-opus-4-6",
    });
  });

  it("returns tool_use for assistant with tool_use stop_reason", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: "tool_use", model: "claude-sonnet-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: "tool_use",
      model: "claude-sonnet-4-6",
    });
  });

  it("returns thinking for assistant with null stop_reason", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { stop_reason: null, model: "claude-opus-4-6" },
    });
    expect(deriveState([line])).toEqual({
      state: "thinking",
      model: "claude-opus-4-6",
    });
  });

  it("returns thinking for assistant with no stop_reason", () => {
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
    // Assistant is last → waiting
    expect(deriveState([user, assistant])).toEqual({
      state: "waiting",
      model: "claude-opus-4-6",
    });
  });

  it("skips non-user/assistant types", () => {
    const system = JSON.stringify({ type: "system" });
    const user = JSON.stringify({ type: "user" });
    // system is last but skipped, user is found
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
  it("replaces slashes and dots with dashes", () => {
    expect(encodeProjectPath("/home/user/project.name")).toBe(
      "-home-user-project-name",
    );
  });

  it("handles root path", () => {
    expect(encodeProjectPath("/")).toBe("-");
  });

  it("handles path with no special characters", () => {
    expect(encodeProjectPath("simple")).toBe("simple");
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

  it("detects different state", () => {
    expect(infoEqual(info, { ...info, state: "waiting" })).toBe(false);
  });

  it("detects different sessionId", () => {
    expect(infoEqual(info, { ...info, sessionId: "other" })).toBe(false);
  });

  it("detects different model", () => {
    expect(infoEqual(info, { ...info, model: "claude-sonnet-4-6" })).toBe(
      false,
    );
  });
});
