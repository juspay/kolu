import { describe, expect, it } from "vitest";
import { migrateLegacyTerminal_1_18_0 } from "./state.ts";

// KOLU_STATE_DIR is set by the `test:unit` script in package.json — state.ts
// reads it at module load.

describe("migrateLegacyTerminal_1_18_0", () => {
  it("synthesizes GitInfo from legacy repoName + branch (#714 regression)", () => {
    const migrated = migrateLegacyTerminal_1_18_0({
      id: "term-1",
      cwd: "/home/alice/projects/app",
      repoName: "app",
      branch: "main",
      sortOrder: 3,
    });
    expect(migrated).toMatchObject({
      id: "term-1",
      cwd: "/home/alice/projects/app",
      git: {
        repoName: "app",
        branch: "main",
        // Path fields seed from cwd (best-guess; live git provider overwrites
        // on first restore). No empty-string sentinels.
        repoRoot: "/home/alice/projects/app",
        worktreePath: "/home/alice/projects/app",
        isWorktree: false,
        mainRepoRoot: "/home/alice/projects/app",
      },
    });
    expect(migrated).not.toHaveProperty("repoName");
    expect(migrated).not.toHaveProperty("branch");
    expect(migrated).not.toHaveProperty("sortOrder");
  });

  it("stamps git: null for legacy non-git entries (no repoName/branch)", () => {
    const migrated = migrateLegacyTerminal_1_18_0({
      id: "term-2",
      cwd: "/tmp",
    });
    expect(migrated).toEqual({ id: "term-2", cwd: "/tmp", git: null });
  });

  it("preserves existing git when entry already has the new shape", () => {
    const existingGit = {
      repoRoot: "/home/alice/projects/app",
      repoName: "app",
      worktreePath: "/home/alice/projects/app",
      branch: "feature",
      isWorktree: false,
      mainRepoRoot: "/home/alice/projects/app",
    };
    const migrated = migrateLegacyTerminal_1_18_0({
      id: "term-3",
      cwd: "/home/alice/projects/app",
      git: existingGit,
    });
    expect(migrated).toEqual({
      id: "term-3",
      cwd: "/home/alice/projects/app",
      git: existingGit,
    });
  });

  it("prefers existing git over legacy fields when both present", () => {
    // Edge case: a corrupt entry carries BOTH new-shape `git` AND legacy
    // flat `repoName`/`branch`. The existing `git` wins.
    const populatedGit = {
      repoRoot: "/home/alice/projects/real",
      repoName: "real",
      worktreePath: "/home/alice/projects/real",
      branch: "real-branch",
      isWorktree: false,
      mainRepoRoot: "/home/alice/projects/real",
    };
    const migrated = migrateLegacyTerminal_1_18_0({
      id: "term-x",
      cwd: "/home/alice/projects/real",
      git: populatedGit,
      repoName: "stale",
      branch: "stale-branch",
    });
    expect(migrated).toEqual({
      id: "term-x",
      cwd: "/home/alice/projects/real",
      git: populatedGit,
    });
  });

  it("preserves themeName, parentId, canvasLayout, lastAgentCommand", () => {
    const migrated = migrateLegacyTerminal_1_18_0({
      id: "term-4",
      cwd: "/x",
      repoName: "x",
      branch: "main",
      themeName: "Dracula",
      parentId: "term-1",
      canvasLayout: { x: 10, y: 20, w: 300, h: 200 },
      lastAgentCommand: "claude --model sonnet",
    });
    expect(migrated).toMatchObject({
      themeName: "Dracula",
      parentId: "term-1",
      canvasLayout: { x: 10, y: 20, w: 300, h: 200 },
      lastAgentCommand: "claude --model sonnet",
    });
  });
});
