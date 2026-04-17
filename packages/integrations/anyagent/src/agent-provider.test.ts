import { describe, it, expect } from "vitest";
import { agentInfoEqual, type AgentInfoShape } from "./agent-provider.ts";

describe("agentInfoEqual", () => {
  const claude: AgentInfoShape = {
    kind: "claude-code",
    state: "thinking",
    sessionId: "abc-123",
    model: "claude-opus-4-6",
    summary: "Refactor sidebar layout",
    taskProgress: null,
  };

  it("returns true for identical references", () => {
    expect(agentInfoEqual(claude, claude)).toBe(true);
  });

  it("returns true for both null", () => {
    expect(agentInfoEqual(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(agentInfoEqual(claude, null)).toBe(false);
    expect(agentInfoEqual(null, claude)).toBe(false);
  });

  it("returns true for equal values", () => {
    expect(agentInfoEqual(claude, { ...claude })).toBe(true);
  });

  it.each([
    { field: "state", value: "waiting" },
    { field: "sessionId", value: "other" },
    { field: "model", value: "claude-sonnet-4-6" },
    { field: "summary", value: "Different topic" },
    { field: "summary", value: null },
    { field: "taskProgress", value: { total: 3, completed: 1 } },
  ] as const)("detects different $field", ({ field, value }) => {
    expect(
      agentInfoEqual(claude, { ...claude, [field]: value } as AgentInfoShape),
    ).toBe(false);
  });

  it("detects different kind across agent flavors", () => {
    const opencode: AgentInfoShape = {
      kind: "opencode",
      state: "thinking",
      sessionId: "abc-123",
      model: null,
      summary: null,
      taskProgress: null,
    };
    expect(agentInfoEqual(claude, opencode)).toBe(false);
  });

  it("treats taskProgress structurally, not by reference", () => {
    const a: AgentInfoShape = {
      ...claude,
      taskProgress: { total: 5, completed: 3 },
    };
    const b: AgentInfoShape = {
      ...claude,
      taskProgress: { total: 5, completed: 3 },
    };
    expect(agentInfoEqual(a, b)).toBe(true);
  });

  it("detects different taskProgress completed count", () => {
    const a: AgentInfoShape = {
      ...claude,
      taskProgress: { total: 5, completed: 2 },
    };
    const b: AgentInfoShape = {
      ...claude,
      taskProgress: { total: 5, completed: 3 },
    };
    expect(agentInfoEqual(a, b)).toBe(false);
  });
});
