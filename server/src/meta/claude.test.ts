import { describe, it, expect } from "vitest";
import { infoEqual } from "./claude.ts";
import type { AgentInfo, ClaudeCodeInfo } from "kolu-common";

describe("infoEqual", () => {
  const info: ClaudeCodeInfo = {
    kind: "claude-code",
    state: "thinking",
    sessionId: "abc-123",
    model: "claude-opus-4-6",
    summary: "Refactor sidebar layout",
    taskProgress: null,
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
    { field: "summary", value: "Different topic" },
    { field: "summary", value: null },
    { field: "taskProgress", value: { total: 3, completed: 1 } },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(infoEqual(info, { ...info, [field]: value } as AgentInfo)).toBe(
      false,
    );
  });

  it("detects different kind", () => {
    const opencode: AgentInfo = {
      kind: "opencode",
      state: "thinking",
      sessionId: "abc-123",
      model: null,
      summary: null,
    };
    expect(infoEqual(info, opencode)).toBe(false);
  });

  describe("opencode variants", () => {
    const ocInfo: AgentInfo = {
      kind: "opencode",
      state: "thinking",
      sessionId: "oc-123",
      model: "anthropic/claude-sonnet-4-5",
      summary: "Fix auth flow",
    };

    it("returns true for equal opencode values", () => {
      expect(infoEqual(ocInfo, { ...ocInfo })).toBe(true);
    });

    it.each([
      { field: "state", value: "waiting" },
      { field: "sessionId", value: "other" },
      { field: "model", value: "openai/gpt-4o" },
      { field: "summary", value: "Different topic" },
      { field: "summary", value: null },
    ] as const)("detects different $field", ({ field, value }) => {
      expect(
        infoEqual(ocInfo, { ...ocInfo, [field]: value } as AgentInfo),
      ).toBe(false);
    });
  });
});
