import {
  backfillLocation,
  backfillRemoteUrl,
  backfillTerminalState,
  LOCAL_LOCATION,
} from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  migrateLegacyTerminal_1_18_0,
  migratePreferences_1_30_0,
} from "./state.ts";

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

describe("migratePreferences_1_30_0", () => {
  it("maps legacy shuffleTheme: true → { shuffle, auto } (the new default)", () => {
    const migrated = migratePreferences_1_30_0({
      shuffleTheme: true,
      scrollLock: true,
    });
    expect(migrated).toEqual({
      newTerminalTheme: "shuffle",
      shuffleBehavior: "auto",
      scrollLock: true,
    });
    expect(migrated).not.toHaveProperty("shuffleTheme");
  });

  it("maps legacy shuffleTheme: false → { inherit, auto }", () => {
    const migrated = migratePreferences_1_30_0({ shuffleTheme: false });
    expect(migrated).toEqual({
      newTerminalTheme: "inherit",
      shuffleBehavior: "auto",
    });
  });

  it("legacy shuffleTheme wins over spread-injected new-field defaults", () => {
    // A very old record re-runs the 1.10.0 step first, which spreads the
    // current DEFAULT_PREFERENCES (newTerminalTheme: "shuffle") in alongside the
    // still-present shuffleTheme. The user's real off intent must override.
    const migrated = migratePreferences_1_30_0({
      shuffleTheme: false,
      newTerminalTheme: "shuffle",
    });
    expect(migrated).toEqual({
      newTerminalTheme: "inherit",
      shuffleBehavior: "auto",
    });
  });

  it("leaves a record with no shuffleTheme untouched (fresh ≥1.30 install)", () => {
    const fresh = { newTerminalTheme: "inherit", shuffleBehavior: "dark" };
    expect(migratePreferences_1_30_0(fresh)).toEqual(fresh);
  });
});

describe("backfillRemoteUrl", () => {
  it("backfills remoteUrl: null on an already-migrated git record missing the field", () => {
    // The common shape: a session saved between the 1.18 migration and 1.25
    // carries a populated `git` with no `remoteUrl`.
    const migrated = backfillRemoteUrl({
      id: "term-1",
      cwd: "/home/alice/app",
      git: {
        repoRoot: "/home/alice/app",
        repoName: "app",
        worktreePath: "/home/alice/app",
        branch: "main",
        isWorktree: false,
        mainRepoRoot: "/home/alice/app",
      },
    });
    expect(migrated).toEqual({
      id: "term-1",
      cwd: "/home/alice/app",
      git: {
        repoRoot: "/home/alice/app",
        repoName: "app",
        worktreePath: "/home/alice/app",
        branch: "main",
        isWorktree: false,
        mainRepoRoot: "/home/alice/app",
        remoteUrl: null,
      },
    });
  });

  it("is idempotent — a git record that already has remoteUrl passes through", () => {
    const git = {
      repoRoot: "/r",
      repoName: "r",
      worktreePath: "/r",
      branch: "main",
      isWorktree: false,
      mainRepoRoot: "/r",
      remoteUrl: "https://github.com/owner/r.git",
    };
    const migrated = backfillRemoteUrl({ id: "t", cwd: "/r", git });
    expect(migrated).toEqual({ id: "t", cwd: "/r", git });
  });

  it("leaves a null git untouched", () => {
    const migrated = backfillRemoteUrl({
      id: "t",
      cwd: "/tmp",
      git: null,
    });
    expect(migrated).toEqual({ id: "t", cwd: "/tmp", git: null });
  });
});

describe("backfillLocation", () => {
  it("no location ⇒ { kind: local } (every pre-1.26 terminal was in-process)", () => {
    const migrated = backfillLocation({
      id: "term-1",
      cwd: "/home/alice/app",
      git: null,
    });
    expect(migrated).toEqual({
      id: "term-1",
      cwd: "/home/alice/app",
      git: null,
      location: LOCAL_LOCATION,
    });
  });

  it("is idempotent — a record that already carries a location passes through", () => {
    // A future remote terminal (or a re-run of the migration): the saved
    // location wins, never clobbered back to local — including a remote host
    // that happens to be named "local", which the DU keeps distinct.
    const record = {
      id: "t",
      cwd: "/r",
      git: null,
      location: { kind: "remote", hostId: "local" },
    };
    expect(backfillLocation(record)).toEqual(record);
  });
});

describe("backfillTerminalState", () => {
  it("no state ⇒ active (every pre-1.27 terminal was an attached PTY)", () => {
    const migrated = backfillTerminalState({
      id: "term-1",
      cwd: "/home/alice/app",
      git: null,
      location: LOCAL_LOCATION,
    });
    expect(migrated).toEqual({
      id: "term-1",
      cwd: "/home/alice/app",
      git: null,
      location: LOCAL_LOCATION,
      state: "active",
    });
  });

  it("is idempotent — a record that already carries a state passes through", () => {
    // A future sleeping terminal (or a re-run of the migration): the saved
    // state wins, never clobbered back to active, and its sleeping-only
    // `sleptAt` rides through untouched.
    const record = {
      id: "t",
      cwd: "/r",
      git: null,
      location: LOCAL_LOCATION,
      state: "sleeping",
      sleptAt: 1_700_000_000_000,
    };
    expect(backfillTerminalState(record)).toEqual(record);
  });
});
