import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { WorkspaceSwitcherSourceEntry } from "./order";
import { agentBucket, buildWorkspaceSwitcherModel } from "./model";

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

function source(
  id: string,
  overrides: Partial<TerminalMetadata> = {},
): WorkspaceSwitcherSourceEntry {
  return {
    id,
    info: makeInfo(id, overrides),
  };
}

function modelFor(
  entries: WorkspaceSwitcherSourceEntry[],
  options?: Parameters<typeof buildWorkspaceSwitcherModel>[1],
) {
  return buildWorkspaceSwitcherModel(entries, options);
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
  const entries: WorkspaceSwitcherSourceEntry[] = [
    source("t1", {
      agent: makeAgent({ state: "waiting" }),
      git: makeGit({ repoName: "kolu", branch: "bug-828" }),
    }),
    source("t2", {
      agent: makeAgent({ state: "tool_use", summary: "Refactor API client" }),
      git: makeGit({ repoName: "kolu", branch: "api-refactor" }),
    }),
    source("t3", {
      git: makeGit({
        repoRoot: "/home/user/emanote",
        repoName: "emanote",
        branch: "docs",
        worktreePath: "/home/user/emanote",
        mainRepoRoot: "/home/user/emanote",
      }),
      foreground: { name: "vim", title: "vim README.md" },
    }),
    source("t4", {
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
  ];

  it("derives compact repo groups from the same live entries", () => {
    const model = modelFor(entries);

    expect(
      model.compactGroups.map((group) => ({
        repoName: group.repoName,
        itemIds: group.items.map((item) => item.id),
      })),
    ).toEqual([
      { repoName: "kolu", itemIds: ["t1", "t2"] },
      { repoName: "emanote", itemIds: ["t3"] },
      { repoName: "nogit", itemIds: ["t4"] },
    ]);
  });

  it("buckets visible terminals by live agent state", () => {
    const model = modelFor(entries);

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
    const model = modelFor(entries, { query: "api" });

    expect(model.repoFacets).toEqual([
      { repoName: "kolu", count: 1, color: "oklch(0.75 0.14 20)" },
    ]);
    expect(model.visibleEntries.map((entry) => entry.id)).toEqual(["t2"]);
  });

  it("filters visible entries by repo facet without changing search counts", () => {
    const model = modelFor(entries, { repoFilter: "emanote" });

    expect(model.repoFacets).toEqual([
      { repoName: "kolu", count: 2, color: "oklch(0.75 0.14 20)" },
      { repoName: "emanote", count: 1, color: "oklch(0.75 0.14 20)" },
      { repoName: "nogit", count: 1, color: "oklch(0.75 0.14 20)" },
    ]);
    expect(model.visibleEntries.map((entry) => entry.id)).toEqual(["t3"]);
    expect(model.selectedRepo).toBe("emanote");
  });

  it("drops a selected repo when the current query has no matching facet", () => {
    const model = modelFor(entries, {
      query: "api",
      repoFilter: "emanote",
    });

    expect(model.repoFacets).toEqual([
      { repoName: "kolu", count: 1, color: "oklch(0.75 0.14 20)" },
    ]);
    expect(model.selectedRepo).toBeNull();
    expect(model.visibleEntries.map((entry) => entry.id)).toEqual(["t2"]);
  });

  it("searches foreground, pull request, agent, cwd, and command metadata", () => {
    expect(
      modelFor(entries, { query: "vim readme" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(entries, { query: "parallelization" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(entries, { query: "flaky checkout" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(entries, { query: "scratch-space" }).visibleEntries,
    ).toHaveLength(1);
    expect(
      modelFor(entries, { query: "claude sonnet" }).visibleEntries,
    ).toHaveLength(1);
  });
});
