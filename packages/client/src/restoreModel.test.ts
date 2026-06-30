import { LOCAL_LOCATION, type SavedTerminal } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { resumableTerminalIds } from "./restoreModel.ts";

const base = {
  cwd: "/work/repo",
  git: null,
  // `pr` is restore-relevant now (persisted like `git`); every SavedTerminal
  // carries it. A pre-cutover record with no resolved PR is `{ kind: "absent" }`.
  pr: { kind: "absent" },
  location: LOCAL_LOCATION,
  lastActivityAt: 0,
} as const;

/** An `exact` restore target for the given command — what `restoreTargetOf`
 *  produces for a terminal whose agent was live. */
const exactTarget = (command: string): SavedTerminal["restoreTarget"] => ({
  kind: "exact",
  command,
  agent: { kind: "claude-code", sessionId: "ses-A" },
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
  // A sleeping record keeps its `restoreTarget` on its persisted base — but it
  // restores DORMANT, so it must NOT count as a resumable agent.
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
  // Ran an agent, then quit to a shell: `lastAgentCommand` lingers but the fold
  // wrote `restoreTarget: none`, so wake brings back a bare shell — NOT resumable.
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

describe("resumableTerminalIds", () => {
  it("excludes SLEEPING, quit-to-shell, and sub terminals — only a live exact/legacy target resumes", () => {
    const ids = resumableTerminalIds([
      activeWithAgent,
      sleepingWithAgent,
      activeNoAgent,
      activeQuitToShell,
      subWithAgent,
    ]);
    // Only the live, top-level terminal with a resumable target counts.
    expect(ids).toEqual(["active-agent"]);
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
});
