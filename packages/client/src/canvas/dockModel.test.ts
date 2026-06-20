import {
  activeArm,
  type ActiveTerminal,
  type AgentInfo,
  LOCAL_LOCATION,
} from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import type { IdleBucketKey } from "../terminal/activityWindow";
import type { TerminalDisplayInfo } from "../terminal/terminalDisplay";
import {
  agentBucket,
  buildDockModel,
  type DockSourceEntry,
  sortDockEntriesByRecency,
} from "./dockModel";
import type { TileLayout } from "./TileLayout";

function makeGit(overrides: Partial<GitInfo> = {}): GitInfo {
  return {
    repoRoot: "/home/user/kolu",
    repoName: "kolu",
    worktreePath: "/home/user/kolu",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/home/user/kolu",
    remoteUrl: null,
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

function makeMeta(overrides: Partial<ActiveTerminal> = {}): ActiveTerminal {
  return {
    state: "active",
    cwd: "/home/user/kolu",
    git: makeGit(),
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    lastActivityAt: 0,
    ...overrides,
  };
}

function makeInfo(
  id: string,
  overrides: Partial<ActiveTerminal> = {},
): TerminalDisplayInfo {
  const meta = makeMeta(overrides);
  return {
    meta,
    subCount: 0,
    repoColor: "oklch(0.75 0.14 20)",
    branchColor: "oklch(0.75 0.14 140)",
    annotationColor: "oklch(0.75 0.14 140)",
    key: {
      group: meta.git?.repoName ?? "nogit",
      label: meta.git?.branch ?? meta.cwd,
      suffix: id === "t4" ? "#t4" : undefined,
    },
  };
}

function source(
  id: string,
  overrides: Partial<ActiveTerminal> = {},
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

function modelFor(
  entries: DockSourceEntry[],
  options?: Parameters<typeof buildDockModel>[1],
) {
  return buildDockModel(entries, options);
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

describe("buildDockModel", () => {
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
          checkRuns: [],
        },
      },
    }),
  ];

  it("buckets visible terminals by live agent state", () => {
    const model = modelFor(entries);

    expect(model.columns.map((column) => column.key)).toEqual([
      "idle",
      "awaiting",
      "working",
      "none",
    ]);
    // Idle leads, but is empty in this fixture (no isStale supplied).
    expect(model.columns[0]?.entries).toHaveLength(0);
    expect(model.columns[1]?.entries.map((entry) => entry.id)).toEqual(["t1"]);
    expect(model.columns[2]?.entries.map((entry) => entry.id)).toEqual(["t2"]);
    expect(model.columns[3]?.entries.map((entry) => entry.id)).toEqual([
      "t3",
      "t4",
    ]);
  });

  it("emits an empty Idle column when no isStale predicate is supplied", () => {
    const model = modelFor(entries);
    const idle = model.columns.find((c) => c.key === "idle");
    expect(idle?.entries).toHaveLength(0);
    // Idle column always carries its sub-bucket ladder so the renderer
    // can iterate it once even when nothing is parked.
    expect(idle?.idleSubBuckets?.map((s) => s.key)).toEqual([
      "4h-12h",
      "12h-24h",
      "24h-48h",
      "48h+",
    ]);
  });

  it("routes stale entries into the Idle column regardless of agent state", () => {
    // Stale-awaiting agents (laptop slept past the window) belong in
    // Idle — the activity-window selector must actually compress them
    // out of the Awaiting column, or it has no effect on the wall-of-
    // yesterday's-cards problem it exists to solve. Identity for those
    // entries is preserved at the *render* layer (`QuietRowBody` paints
    // the AgentIndicator when `meta.agent` is set), not by promoting
    // them back into the Awaiting bucket here.
    const seeded = entries.map((entry) =>
      entry.id === "t1" || entry.id === "t3"
        ? {
            ...entry,
            info: {
              ...entry.info,
              meta: { ...entry.info.meta, lastActivityAt: 1 },
            },
          }
        : entry,
    );
    const m = modelFor(seeded, {
      idleClassifier: (lastActivityAt) =>
        lastActivityAt === 1 ? "4h-12h" : null,
    });
    // t1 (was awaiting) AND t3 (was no-agent) both route to Idle.
    expect(m.columns[0]?.entries.map((e) => e.id).sort()).toEqual(["t1", "t3"]);
    // Awaiting column empties — the t1 waiter compressed into Idle.
    expect(m.columns[1]?.entries).toHaveLength(0);
    expect(m.columns[2]?.entries.map((e) => e.id)).toEqual(["t2"]);
    expect(m.columns[3]?.entries.map((e) => e.id)).toEqual(["t4"]);
    expect(m.entries.find((e) => e.id === "t1")?.bucket).toBe("idle");
    expect(m.entries.find((e) => e.id === "t3")?.bucket).toBe("idle");
    // The agent metadata survives the bucket move — the render layer
    // (`DockRow` / `DockListRow`) reads `info.meta.agent` to paint the
    // agent state pip and subline on parked rows.
    expect(
      activeArm(m.entries.find((e) => e.id === "t1")?.info.meta)?.agent?.state,
    ).toBe("waiting");
  });

  it("groups Idle entries by age into the 4-rung sub-bucket ladder", () => {
    // Each terminal's lastActivityAt names the bucket the test expects
    // it to land in — the classifier reads it back as a literal lookup
    // so we don't need an injected clock.
    const sources: DockSourceEntry[] = [
      source("fresh", { lastActivityAt: 1 }),
      source("dayish", { lastActivityAt: 2 }),
      source("yesterday", { lastActivityAt: 3 }),
      source("weekago", { lastActivityAt: 4 }),
    ];
    const byMarker: Record<number, IdleBucketKey | null> = {
      1: "4h-12h",
      2: "12h-24h",
      3: "24h-48h",
      4: "48h+",
    };
    const m = buildDockModel(sources, {
      idleClassifier: (lastActivityAt) => byMarker[lastActivityAt] ?? null,
    });
    const idle = m.columns.find((c) => c.key === "idle");
    const subEntries = (key: string) =>
      idle?.idleSubBuckets
        ?.find((s) => s.key === key)
        ?.entries.map((e) => e.id) ?? [];
    expect(subEntries("4h-12h")).toEqual(["fresh"]);
    expect(subEntries("12h-24h")).toEqual(["dayish"]);
    expect(subEntries("24h-48h")).toEqual(["yesterday"]);
    expect(subEntries("48h+")).toEqual(["weekago"]);
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
