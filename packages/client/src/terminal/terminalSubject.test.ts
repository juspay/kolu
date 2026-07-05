import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "./terminalDisplay";
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

function info(meta: TerminalMetadata): TerminalDisplayInfo {
  return {
    meta,
    repoColor: "#000",
    branchColor: "#111",
    annotationColor: "#111",
    subCount: 0,
    key: {
      group: meta.git?.repoName ?? "repo",
      label: meta.git?.branch ?? meta.cwd,
    },
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
    expect(
      terminalSubject(
        info(meta({ intent: "Keep current task", git: git("new-branch") })),
        "Terminal 1",
      ).title,
    ).toBe("repo/Keep current task");
  });
});
