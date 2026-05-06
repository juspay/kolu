import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { TileLayout } from "../TileLayout";
import {
  agentBucket,
  buildWorkspaceSwitcherModel,
  sortBySwitcherOrder,
  type WorkspaceSwitcherSourceEntry,
} from "./model";

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
    lastActivityAt: 0,
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
  layout?: TileLayout,
): WorkspaceSwitcherSourceEntry {
  return {
    id,
    info: makeInfo(id, overrides),
    layout,
  };
}

function layout(x: number, y: number, w = 4, h = 3): TileLayout {
  return { x, y, w, h };
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

describe("sortBySwitcherOrder", () => {
  const entries: WorkspaceSwitcherSourceEntry[] = [
    source("a", {}, layout(0, 0)),
    source("b", {}, layout(10, 0)),
    source("c", {}, layout(0, 10)),
    source("d"),
  ];

  function ids(sorted: WorkspaceSwitcherSourceEntry[]): string[] {
    return sorted.map((entry) => entry.id);
  }

  it("orders by recency descending when timestamps differ", () => {
    const recency: Record<string, number> = { a: 100, b: 300, c: 200, d: 400 };
    expect(ids(sortBySwitcherOrder(entries, (id) => recency[id] ?? 0))).toEqual(
      ["d", "b", "c", "a"],
    );
  });

  it("falls back to canvas x then y when recency ties", () => {
    expect(ids(sortBySwitcherOrder(entries, () => 0))).toEqual([
      "a", // x=0, y=0
      "c", // x=0, y=10
      "b", // x=10, y=0
      "d", // no layout — Infinity, sorts last
    ]);
  });

  it("preserves input order on full tie (stable sort)", () => {
    const tied: WorkspaceSwitcherSourceEntry[] = [
      source("p"),
      source("q"),
      source("r"),
    ];
    expect(ids(sortBySwitcherOrder(tied, () => 0))).toEqual(["p", "q", "r"]);
  });

  it("does not mutate the input array", () => {
    const before = [...entries];
    sortBySwitcherOrder(entries, () => 0);
    expect(entries).toEqual(before);
  });

  it("places a recently-active terminal ahead of an older canvas-leading one", () => {
    const sources: WorkspaceSwitcherSourceEntry[] = [
      source("t-old", {}, layout(0, 0)),
      source("t-new", {}, layout(999, 0)),
    ];
    const recency: Record<string, number> = { "t-old": 100, "t-new": 200 };
    expect(ids(sortBySwitcherOrder(sources, (id) => recency[id] ?? 0))).toEqual(
      ["t-new", "t-old"],
    );
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

  it("derives compact repo groups: alphabetical by repo, alphabetical by branch within repo", () => {
    const model = modelFor(entries);

    expect(
      model.compactGroups.map((group) => ({
        repoName: group.repoName,
        itemIds: group.items.map((item) => item.id),
      })),
    ).toEqual([
      { repoName: "emanote", itemIds: ["t3"] },
      // t2's branch "api-refactor" sorts before t1's "bug-828"
      { repoName: "kolu", itemIds: ["t2", "t1"] },
      { repoName: "nogit", itemIds: ["t4"] },
    ]);
  });

  it("caps idle pills at IDLE_PILLS_PER_REPO, then alphabetizes within", () => {
    // Seven idle peers in the same repo (no agent). The five most-recent
    // are kept (input order is recency desc); alpha-sort by branch then
    // fixes their position.
    const branches = [
      "z-feature", // most recent
      "alpha",
      "delta",
      "beta",
      "charlie",
      "epsilon", // 6th — should be evicted (idle, over cap)
      "omega", // 7th — should be evicted
    ];
    const sources = branches.map((branch, i) =>
      source(`r${i}`, { git: makeGit({ repoName: "many", branch }) }),
    );
    const model = modelFor(sources);
    const kept = model.compactGroups.find((g) => g.repoName === "many");
    expect(kept?.items.map((item) => item.label)).toEqual([
      "alpha",
      "beta",
      "charlie",
      "delta",
      "z-feature",
    ]);
  });

  it("never hides an active-agent terminal, even past the idle cap", () => {
    // Five idle peers fill the cap; a sixth terminal carries an active
    // agent and must still appear. Order remains alphabetical by branch.
    const idleBranches = ["alpha", "beta", "charlie", "delta", "epsilon"];
    const idleSources = idleBranches.map((branch, i) =>
      source(`r${i}`, { git: makeGit({ repoName: "many", branch }) }),
    );
    const agentSource = source("r-agent", {
      git: makeGit({ repoName: "many", branch: "zeta" }),
      agent: makeAgent({ state: "thinking" }),
    });
    const model = modelFor([...idleSources, agentSource]);
    const kept = model.compactGroups.find((g) => g.repoName === "many");
    expect(kept?.items.map((item) => item.label)).toEqual([
      "alpha",
      "beta",
      "charlie",
      "delta",
      "epsilon",
      "zeta",
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
