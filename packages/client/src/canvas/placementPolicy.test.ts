import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { GitInfo } from "kolu-git/schemas";
import { describe, expect, it } from "vitest";
import { buildTerminalDisplayInfos } from "../terminal/terminalDisplay";
import type { TerminalStore } from "../terminal/useTerminalStore";
import { resolvePlacementBucket } from "./placementPolicy";

function git(overrides: Partial<GitInfo>): GitInfo {
  return {
    repoRoot: "/r",
    repoName: "r",
    worktreePath: "/r",
    branch: "main",
    isWorktree: false,
    mainRepoRoot: "/r",
    remoteUrl: null,
    isBare: false,
    ...overrides,
  };
}

function meta(cwd: string, gitInfo: GitInfo | null = null): TerminalMetadata {
  return {
    cwd,
    home: "/home/u",
    git: gitInfo === null ? { kind: "none" } : { kind: "repo", info: gitInfo },
    pr: null,
    agent: null,
    foreground: null,
    parentId: null,
    canvasLayout: undefined,
    themeName: null,
    subPanel: null,
    lastActivityAt: 0,
  } as unknown as TerminalMetadata;
}

function stubStore(
  entries: { id: TerminalId; meta: TerminalMetadata }[],
): TerminalStore {
  const byId = new Map(entries.map((e) => [e.id, e.meta]));
  const ids = entries.map((e) => e.id);
  const displayInfos = buildTerminalDisplayInfos(
    ids,
    (id) => byId.get(id),
    () => [],
  );
  return {
    getMetadata: (id: TerminalId) => byId.get(id),
    getDisplayInfo: (id: TerminalId) => displayInfos.get(id),
    terminalIds: () => ids,
    activeId: () => null,
    activeMeta: () => null,
    terminalLabel: () => "",
    getSubTerminalIds: () => [],
  } as unknown as TerminalStore;
}

describe("resolvePlacementBucket", () => {
  it("returns own bucket when it directly matches a candidate", () => {
    const store = stubStore([
      {
        id: "tile-1",
        meta: meta("/r", git({ repoRoot: "/r", mainRepoRoot: "/r" })),
      },
      {
        id: "new",
        meta: meta("/r/sub", git({ repoRoot: "/r", mainRepoRoot: "/r" })),
      },
    ]);
    expect(resolvePlacementBucket(store, "new", ["tile-1"])).toBe("r");
  });

  it("falls back to parent-repo containment via mainRepoRoot when every candidate is a worktree of the same repo", () => {
    const store = stubStore([
      {
        id: "wt0",
        meta: meta(
          "/r/.worktrees/wt0",
          git({
            repoRoot: "/r/.worktrees/wt0",
            mainRepoRoot: "/r",
            isWorktree: true,
          }),
        ),
      },
      {
        id: "wt1",
        meta: meta("/r/.worktrees/wt1", null),
      },
    ]);
    expect(resolvePlacementBucket(store, "wt1", ["wt0"])).toBe("r");
  });

  it("prefers same-worktree containment over parent-repo containment", () => {
    const store = stubStore([
      {
        id: "main",
        meta: meta("/r", git({ repoRoot: "/r", mainRepoRoot: "/r" })),
      },
      {
        id: "wt-deep",
        meta: meta(
          "/r/.worktrees/wt0",
          git({
            repoRoot: "/r/.worktrees/wt0",
            mainRepoRoot: "/r",
            isWorktree: true,
            repoName: "wt-deep-repoName",
          }),
        ),
      },
      {
        id: "new",
        meta: meta("/r/.worktrees/wt0/sub", null),
      },
    ]);
    expect(resolvePlacementBucket(store, "new", ["main", "wt-deep"])).toBe(
      "wt-deep-repoName",
    );
  });

  it("returns undefined when the new tile has no cwd and no matching bucket", () => {
    const store = {
      getMetadata: () => ({ cwd: undefined }) as unknown as TerminalMetadata,
      getDisplayInfo: () => undefined,
    } as unknown as TerminalStore;
    expect(resolvePlacementBucket(store, "new", [])).toBeUndefined();
  });
});
