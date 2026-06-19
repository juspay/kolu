import { describe, expect, it } from "vitest";
import { shouldBumpRecencyForAgentChange } from "./agentRecency.ts";
import type { AgentInfo } from "./schema.ts";

function claude(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "sess-A",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
  };
}

describe("shouldBumpRecencyForAgentChange", () => {
  it("bumps on first detection for a fresh terminal (lastActivityAt === 0)", () => {
    expect(shouldBumpRecencyForAgentChange(null, claude("thinking"), 0)).toBe(
      true,
    );
  });

  it("does NOT bump on first detection for a restored terminal", () => {
    // The case the production restart tripped on: agent state was wiped
    // by the restart, the saved `lastActivityAt` was correctly threaded
    // through restore, and the agent adapter's first re-observation
    // would otherwise stamp Date.now() over the saved value. We must
    // preserve the saved truth until a real state change happens.
    const T_yesterday = 1_700_000_000_000;
    expect(
      shouldBumpRecencyForAgentChange(null, claude("thinking"), T_yesterday),
    ).toBe(false);
  });

  it("bumps on a real state change within the session", () => {
    expect(
      shouldBumpRecencyForAgentChange(
        claude("thinking"),
        claude("waiting"),
        1_700_000_000_000,
      ),
    ).toBe(true);
  });

  it("does NOT bump when only sub-info changes (same kind/sessionId/state)", () => {
    const a = claude("thinking");
    const b: AgentInfo = { ...a, summary: "different summary" };
    expect(shouldBumpRecencyForAgentChange(a, b, 1_700_000_000_000)).toBe(
      false,
    );
  });

  it("bumps when the agent session ends (non-null → null)", () => {
    expect(
      shouldBumpRecencyForAgentChange(
        claude("waiting"),
        null,
        1_700_000_000_000,
      ),
    ).toBe(true);
  });

  it("bumps when a different session takes over (different sessionId)", () => {
    const a: AgentInfo = { ...claude("thinking"), sessionId: "sess-A" };
    const b: AgentInfo = { ...claude("thinking"), sessionId: "sess-B" };
    expect(shouldBumpRecencyForAgentChange(a, b, 1_700_000_000_000)).toBe(true);
  });
});
