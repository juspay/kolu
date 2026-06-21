import { LOCAL_LOCATION, type SavedTerminal } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { resumableTerminalIds } from "./restoreModel.ts";

const base = {
  cwd: "/work/repo",
  git: null,
  location: LOCAL_LOCATION,
  lastActivityAt: 0,
} as const;

const activeWithAgent: SavedTerminal = {
  ...base,
  id: "active-agent",
  state: "active",
  lastAgentCommand: "claude --permission-mode auto",
};
const sleepingWithAgent: SavedTerminal = {
  ...base,
  id: "sleeping-agent",
  state: "sleeping",
  sleptAt: 1,
  // A sleeping record keeps `lastAgentCommand` on its persisted base — but it
  // restores DORMANT, so it must NOT count as a resumable agent.
  lastAgentCommand: "claude --permission-mode auto",
};
const activeNoAgent: SavedTerminal = {
  ...base,
  id: "active-bare",
  state: "active",
};
const subWithAgent: SavedTerminal = {
  ...base,
  id: "sub-agent",
  state: "active",
  parentId: "active-agent",
  lastAgentCommand: "claude",
};

describe("resumableTerminalIds", () => {
  it("excludes SLEEPING terminals — they restore dormant, never resuming an agent", () => {
    const ids = resumableTerminalIds([
      activeWithAgent,
      sleepingWithAgent,
      activeNoAgent,
      subWithAgent,
    ]);
    // Only the live, top-level, agent-carrying terminal resumes.
    expect(ids).toEqual(["active-agent"]);
  });

  it("returns [] when every agent-carrying terminal is asleep", () => {
    expect(resumableTerminalIds([sleepingWithAgent])).toEqual([]);
  });
});
