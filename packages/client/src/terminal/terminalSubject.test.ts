import { type ActiveTerminal, LOCAL_LOCATION } from "@kolu/padi/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import { buildTerminalDisplayInfos } from "./terminalDisplay";
import { terminalSubject } from "./terminalSubject";

function git(branch: string): GitInfo {
  return {
    repoRoot: "/repo",
    repoName: "repo",
    worktreePath: "/repo",
    branch,
    isWorktree: false,
    mainRepoRoot: "/repo",
    remoteUrl: null,
  };
}

function meta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/repo",
    git: git("main"),
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

describe("terminalSubject", () => {
  it("uses the intent line before the git branch in user-facing subjects", () => {
    const infos = buildTerminalDisplayInfos(
      ["t1"],
      () => meta({ intent: "Keep current task", git: git("new-branch") }),
      () => [],
    );
    expect(terminalSubject(infos.get("t1"), "Terminal 1").title).toBe(
      "repo/Keep current task",
    );
  });

  it("uses presentation suffixes for same-intent terminals on different branches", () => {
    const metas: Record<string, ActiveTerminal> = {
      "aaaa-1": meta({ intent: "Keep current task", git: git("old-branch") }),
      "bbbb-2": meta({ intent: "Keep current task", git: git("new-branch") }),
    };
    const infos = buildTerminalDisplayInfos(
      Object.keys(metas),
      (id) => metas[id],
      () => [],
    );

    expect(terminalSubject(infos.get("aaaa-1"), "Terminal 1").title).toBe(
      "repo/Keep current task#aaaa",
    );
    expect(terminalSubject(infos.get("bbbb-2"), "Terminal 2").title).toBe(
      "repo/Keep current task#bbbb",
    );
  });
});
