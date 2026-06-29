import { describe, expect, it } from "vitest";
import { agentSessionToPersist } from "./agentSession.ts";
import type { AgentInfo, AgentSessionRef } from "./schema.ts";

function claude(
  sessionId: string,
  state: "thinking" | "waiting" = "thinking",
): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId,
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

function codex(sessionId: string): AgentInfo {
  return {
    kind: "codex",
    state: "thinking",
    sessionId,
    model: null,
    summary: null,
    taskProgress: null,
    contextTokens: null,
    startedAt: null,
  };
}

describe("agentSessionToPersist (juspay/kolu#1495)", () => {
  it("persists the ref on first detection (no prior ref)", () => {
    expect(agentSessionToPersist(undefined, claude("sess-A"))).toEqual({
      kind: "claude-code",
      id: "sess-A",
    });
  });

  it("persists a NEW ref when the conversation id changes (A → B)", () => {
    const prev: AgentSessionRef = { kind: "claude-code", id: "sess-A" };
    expect(agentSessionToPersist(prev, claude("sess-B"))).toEqual({
      kind: "claude-code",
      id: "sess-B",
    });
  });

  // The firehose property: a same-session state/summary/token tick must NOT
  // produce a write, or it would re-arm autosave ~every 150 ms.
  it("returns null (no write) when the conversation id is unchanged", () => {
    const prev: AgentSessionRef = { kind: "claude-code", id: "sess-A" };
    expect(agentSessionToPersist(prev, claude("sess-A", "waiting"))).toBeNull();
  });

  // Sticky: an agent exiting keeps the last known conversation so wake/restore
  // can still resume it — exactly like lastAgentCommand.
  it("returns null (keep last ref) when the agent goes away", () => {
    const prev: AgentSessionRef = { kind: "claude-code", id: "sess-A" };
    expect(agentSessionToPersist(prev, null)).toBeNull();
  });

  it("persists a new ref when the agent KIND changes (same id text)", () => {
    const prev: AgentSessionRef = { kind: "claude-code", id: "sess-A" };
    expect(agentSessionToPersist(prev, codex("sess-A"))).toEqual({
      kind: "codex",
      id: "sess-A",
    });
  });
});
