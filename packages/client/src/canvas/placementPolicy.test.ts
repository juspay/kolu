/** Unit-level regression tests for `resolvePlacementBucket`.
 *
 *  The all-worktrees case is what bit production in #844: when every
 *  existing tile is a worktree of the same repo, the containment walk
 *  was checking only `git.repoRoot` (each worktree's own working dir,
 *  never containing another worktree's cwd). The walk now also reads
 *  `git.mainRepoRoot`, the shared parent — these tests pin that
 *  contract without needing to spin a real git repo + e2e harness. */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
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
    ...overrides,
  };
}

function meta(cwd: string, gitInfo: GitInfo | null = null): TerminalMetadata {
  return {
    cwd,
    home: "/home/u",
    git: gitInfo,
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

/** Stub the slice of `TerminalStore` that `resolvePlacementBucket`
 *  reads. Other accessors throw — the function should never reach for
 *  them; if it does, that's a structural change worth catching. */
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
    // Both tiles share repoName "r" → same bucket via direct key match.
    expect(resolvePlacementBucket(store, "new", ["tile-1"])).toBe("r");
  });

  it("falls back to parent-repo containment via mainRepoRoot when every candidate is a worktree of the same repo", () => {
    // Reproduces the production bug from #844. Pre-fix, the fallback
    // walked only `repoRoot` — each worktree's own dir — and the new
    // worktree's cwd never started with any sibling's repoRoot, so
    // the bucket was undefined and `placeNew` returned undefined,
    // cascading the new tile at viewport center. With `mainRepoRoot`
    // in the walk, the shared parent path matches.
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
        // git not yet resolved on the new worktree → ownBucket is the
        // basename-derived "wt1" rather than the shared repoName "r",
        // so the direct-match path doesn't fire and the containment
        // fallback is exercised.
        id: "wt1",
        meta: meta("/r/.worktrees/wt1", null),
      },
    ]);
    expect(resolvePlacementBucket(store, "wt1", ["wt0"])).toBe("r");
  });

  it("prefers same-worktree containment over parent-repo containment", () => {
    // Two candidates both contain the new cwd — the worktree's own
    // repoRoot wins over its parent because `repoRoot` is the longer
    // match (path-length tiebreaker).
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
    // The new cwd is INSIDE wt-deep's working tree, so wt-deep's
    // bucket should win over main's.
    expect(resolvePlacementBucket(store, "new", ["main", "wt-deep"])).toBe(
      "wt-deep-repoName",
    );
  });

  it("returns undefined when the new tile has no cwd and no matching bucket", () => {
    // The new tile has no cwd metadata yet — both the direct-bucket-
    // match path and the containment-walk fallback bail.
    // `stubStore` is bypassed here because `buildTerminalDisplayInfos`
    // calls `cwdBasename(cwd)` → `cwd.replace(...)`, which throws on
    // undefined. The narrow accessors here are exactly the surface
    // `resolvePlacementBucket` reads.
    const store = {
      getMetadata: () => ({ cwd: undefined }) as unknown as TerminalMetadata,
      getDisplayInfo: () => undefined,
    } as unknown as TerminalStore;
    expect(resolvePlacementBucket(store, "new", [])).toBeUndefined();
  });
});
