import type { AgentInfo, TerminalMetadata } from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import type { TileLayout } from "./TileLayout";
import {
  agentBucket,
  type DockSourceEntry,
  searchWorkspaceEntries,
  sortDockEntriesByRecency,
} from "./dockModel";

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
): DockSourceEntry {
  return {
    id,
    info: makeInfo(id, overrides),
    layout,
  };
}

function layout(x: number, y: number, w = 4, h = 3): TileLayout {
  return { x, y, w, h };
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

describe("sortDockEntriesByRecency", () => {
  const entries: DockSourceEntry[] = [
    source("a", {}, layout(0, 0)),
    source("b", {}, layout(10, 0)),
    source("c", {}, layout(0, 10)),
    source("d"),
  ];

  function ids(sorted: DockSourceEntry[]): string[] {
    return sorted.map((entry) => entry.id);
  }

  it("orders by recency descending when timestamps differ", () => {
    const recency: Record<string, number> = { a: 100, b: 300, c: 200, d: 400 };
    expect(
      ids(sortDockEntriesByRecency(entries, (id) => recency[id] ?? 0)),
    ).toEqual(["d", "b", "c", "a"]);
  });

  it("falls back to canvas x then y when recency ties", () => {
    expect(ids(sortDockEntriesByRecency(entries, () => 0))).toEqual([
      "a", // x=0, y=0
      "c", // x=0, y=10
      "b", // x=10, y=0
      "d", // no layout — Infinity, sorts last
    ]);
  });

  it("preserves input order on full tie (stable sort)", () => {
    const tied: DockSourceEntry[] = [source("p"), source("q"), source("r")];
    expect(ids(sortDockEntriesByRecency(tied, () => 0))).toEqual([
      "p",
      "q",
      "r",
    ]);
  });

  it("does not mutate the input array", () => {
    const before = [...entries];
    sortDockEntriesByRecency(entries, () => 0);
    expect(entries).toEqual(before);
  });

  it("places a recently-active terminal ahead of an older canvas-leading one", () => {
    const sources: DockSourceEntry[] = [
      source("t-old", {}, layout(0, 0)),
      source("t-new", {}, layout(999, 0)),
    ];
    const recency: Record<string, number> = { "t-old": 100, "t-new": 200 };
    expect(
      ids(sortDockEntriesByRecency(sources, (id) => recency[id] ?? 0)),
    ).toEqual(["t-new", "t-old"]);
  });
});

describe("searchWorkspaceEntries", () => {
  const entries: DockSourceEntry[] = [
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

  it("returns every entry in recency order", () => {
    const recency: Record<string, number> = { t1: 4, t2: 3, t3: 2, t4: 1 };
    const result = searchWorkspaceEntries(entries, {
      getRecency: (id) => recency[id] ?? 0,
    });
    expect(result.map((e) => e.id)).toEqual(["t1", "t2", "t3", "t4"]);
  });

  // The palette filter (CommandPalette.tsx#filtered) tokenizes the row's
  // `name + description + searchText` and applies AND semantics.
  // `searchWorkspaceEntries` doesn't filter; its contract is that every
  // candidate field a user might type is packed into `searchText` so the
  // palette's filter can hit them. These tests assert that contract.
  function searchTextFor(id: string): string {
    const entry = searchWorkspaceEntries(entries).find((e) => e.id === id);
    if (!entry) throw new Error(`Missing entry ${id}`);
    return entry.searchText;
  }

  it("packs repo and branch into searchText", () => {
    expect(searchTextFor("t3")).toContain("emanote");
    expect(searchTextFor("t2")).toContain("api-refactor");
  });

  it("packs foreground, PR, agent, cwd, and command metadata into searchText", () => {
    expect(searchTextFor("t4")).toContain("parallelization");
    expect(searchTextFor("t1")).toContain("flaky checkout");
    expect(searchTextFor("t4")).toContain("scratch-space");
    expect(searchTextFor("t4")).toContain("claude --model sonnet");
    expect(searchTextFor("t3")).toContain("vim readme.md");
  });
});
