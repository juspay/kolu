import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { WorkspaceSwitcherRepoGroup } from "./workspaceSwitcherOrder";
import {
  agentBucket,
  buildWorkspaceSwitcherModel,
} from "./workspaceSwitcherModel";

function makeGit(overrides: Partial<GitInfo> = {}): GitInfo {
  return {
    repoRoot: "/home/user/kolu",
    repoName: "kolu",
    worktreePath: "/home/user/kolu",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/kolu",
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    kind: "codex",
    state: "waiting",
    sessionId: "codex-session",
    model: "gpt-5.4",
    summary: "Investigate flaky checkout tests",
    taskProgress: null,
    contextTokens: 42000,
    ...overrides,
  } as AgentInfo;
}

function makeMeta(overrides: Partial<TerminalMetadata> = {}): TerminalMetadata {
  return {
    cwd: "/home/user/kolu",
    git: makeGit(),
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ...overrides,
  };
}

function makeInfo(
  id: string,
  overrides: Partial<TerminalMetadata> = {},
): TerminalDisplayInfo {
  const meta = makeMeta(overrides);
  return {
    meta,
    subCount: 0,
    repoColor: "oklch(0.75 0.14 20)",
    branchColor: "oklch(0.75 0.14 140)",
    key: {
      group: meta.git?.repoName ?? "nogit",
      label: meta.git?.branch ?? meta.cwd,
      suffix: id === "t4" ? "#t4" : undefined,
    },
  };
}

function modelFor(
  groups: WorkspaceSwitcherRepoGroup[],
  infos: Record<string, TerminalDisplayInfo>,
  options?: Parameters<typeof buildWorkspaceSwitcherModel>[2],
) {
  return buildWorkspaceSwitcherModel(groups, (id) => infos[id], options);
}

describe("agentBucket", () => {
  it("maps waiting agents to awaiting", () => {
    expect(agentBucket(makeAgent({ state: "waiting" }))).toBe("awaiting");
  });

  it("maps active agents to working", () => {
    expect(agentBucket(makeAgent({ state: "thinking" }))).toBe("working");
    expect(agentBucket(makeAgent({ state: "tool_use" }))).toBe("working");
  });

  it("maps missing agents to none", () => {
    expect(agentBucket(null)).toBe("none");
  });
});

describe("buildWorkspaceSwitcherModel", () => {
  const groups: WorkspaceSwitcherRepoGroup[] = [
    {
      repoName: "kolu",
      items: [
        { id: "t1", label: "bug-828" },
        { id: "t2", label: "api-refactor" },
      ],
    },
    {
      repoName: "emanote",
      items: [
        { id: "t3", label: "docs" },
        { id: "t4", label: "scratch", suffix: "#t4" },
      ],
    },
  ];

  const infos: Record<string, TerminalDisplayInfo> = {
    t1: makeInfo("t1", {
      agent: makeAgent({ state: "waiting" }),
      git: makeGit({ repoName: "kolu", branch: "bug-828" }),
    }),
    t2: makeInfo("t2", {
      agent: makeAgent({ state: "tool_use", summary: "Refactor API client" }),
      git: makeGit({ repoName: "kolu", branch: "api-refactor" }),
    }),
    t3: makeInfo("t3", {
      git: makeGit({
        repoRoot: "/home/user/emanote",
        repoName: "emanote",
        branch: "docs",
        worktreePath: "/home/user/emanote",
        mainRepoRoot: "/home/user/emanote",
      }),
      foreground: { name: "vim", title: "vim README.md" },
    }),
    t4: makeInfo("t4", {
      cwd: "/tmp/scratch-space",
      git: null,
      lastAgentCommand: "claude --model sonnet",
      pr: {
        kind: "ok",
        value: {
          number: 828,
          title: "Facilitate parallelization",
          url: "https://github.com/juspay/kolu/pull/828",
          state: "open",
          checks: "pending",
        },
      },
    }),
  };

  it("buckets visible terminals by live agent state", () => {
    const model = modelFor(groups, infos);

    expect(model.columns.map((column) => column.key)).toEqual([
      "awaiting",
      "working",
      "none",
    ]);
    expect(model.columns[0]?.entries.map((entry) => entry.id)).toEqual(["t1"]);
    expect(model.columns[1]?.entries.map((entry) => entry.id)).toEqual(["t2"]);
    expect(model.columns[2]?.entries.map((entry) => entry.id)).toEqual([
      "t3",
      "t4",
    ]);
  });

  it("builds repo facets from the same query-matched entry set", () => {
    const model = modelFor(groups, infos, { query: "api" });

    expect(model.repoFacets).toEqual([{ repoName: "kolu", count: 1 }]);
    expect(model.visibleEntries.map((entry) => entry.id)).toEqual(["t2"]);
  });

  it("filters visible entries by repo facet without changing search counts", () => {
    const model = modelFor(groups, infos, { repoFilter: "emanote" });

    expect(model.repoFacets).toEqual([
      { repoName: "kolu", count: 2 },
      { repoName: "emanote", count: 2 },
    ]);
    expect(model.visibleEntries.map((entry) => entry.id)).toEqual(["t3", "t4"]);
  });

  it("searches foreground, pull request, agent, cwd, and command metadata", () => {
    expect(
      modelFor(groups, infos, { query: "vim readme" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(groups, infos, { query: "parallelization" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(groups, infos, { query: "flaky checkout" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(groups, infos, { query: "scratch-space" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(groups, infos, { query: "claude sonnet" }).visibleEntries,
    ).toHaveLength(1);
  });
});
