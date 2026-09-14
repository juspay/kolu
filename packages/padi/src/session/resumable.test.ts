import { LOCAL_LOCATION, type SavedTerminal } from "@kolu/padi-client/surface";
import { describe, expect, it } from "vitest";
import { resumableTerminalIds } from "./resumable.ts";

const base = {
  cwd: "/work/repo",
  git: null,
  pr: { kind: "absent" as const },
  location: LOCAL_LOCATION,
  lastActivityAt: 0,
} as const;

/** A claude-code native session id — a UUID, the only shape that passes
 *  `resumeAgentCommand`'s shell-safe id gate (so the `exact` target actually
 *  resumes rather than waking to a bare shell). */
const CLAUDE_ID = "12341234-1234-1234-1234-123412341234";

const exactTarget = (command: string): SavedTerminal["restoreTarget"] => ({
  kind: "exact",
  command,
  agent: { kind: "claude-code", sessionId: CLAUDE_ID },
});

const activeWithAgent: SavedTerminal = {
  ...base,
  id: "active-agent",
  state: "active",
  lastAgentCommand: "claude --permission-mode auto",
  restoreTarget: exactTarget("claude --permission-mode auto"),
};
const sleepingWithAgent: SavedTerminal = {
  ...base,
  id: "sleeping-agent",
  state: "sleeping",
  sleptAt: 1,
  lastAgentCommand: "claude --permission-mode auto",
  restoreTarget: exactTarget("claude --permission-mode auto"),
};
const activeNoAgent: SavedTerminal = {
  ...base,
  id: "active-bare",
  state: "active",
};
const activeQuitToShell: SavedTerminal = {
  ...base,
  id: "active-quit",
  state: "active",
  lastAgentCommand: "claude --permission-mode auto",
  restoreTarget: { kind: "none" },
};
const subWithAgent: SavedTerminal = {
  ...base,
  id: "sub-agent",
  state: "active",
  parentId: "active-agent",
  lastAgentCommand: "claude",
  restoreTarget: exactTarget("claude"),
};

describe("resumableTerminalIds (host-owned)", () => {
  it("includes parented ACTIVE agents — splits resume too", () => {
    const ids = resumableTerminalIds([
      activeWithAgent,
      sleepingWithAgent,
      activeNoAgent,
      activeQuitToShell,
      subWithAgent,
    ]);
    // Live exact targets only; sleeping / quit-to-shell / bare shell excluded.
    // The parented sub IS included — that is the bug class this fold closes.
    expect(ids).toEqual(["active-agent", "sub-agent"]);
  });

  it("counts a `legacyMostRecent` target (migrated pre-1.29 record)", () => {
    const legacy: SavedTerminal = {
      ...base,
      id: "active-legacy",
      state: "active",
      lastAgentCommand: "opencode",
      restoreTarget: { kind: "legacyMostRecent", command: "opencode" },
    };
    expect(resumableTerminalIds([legacy])).toEqual(["active-legacy"]);
  });

  it("returns [] when every agent-carrying terminal is asleep", () => {
    expect(resumableTerminalIds([sleepingWithAgent])).toEqual([]);
  });

  it("excludes an `exact` target whose id can't actually resume (matches wake)", () => {
    const brokenId: SavedTerminal = {
      ...base,
      id: "active-broken-id",
      state: "active",
      lastAgentCommand: "claude",
      restoreTarget: {
        kind: "exact",
        command: "claude",
        agent: { kind: "claude-code", sessionId: "not-a-uuid" },
      },
    };
    expect(resumableTerminalIds([brokenId])).toEqual([]);
  });
});
