import {
  backfillLocation,
  backfillRemoteUrl,
  backfillTerminalState,
  LOCAL_LOCATION,
} from "@kolu/padi/surface";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  migratePreferences_1_30_0,
  migratePreferences_1_32_0,
  migratePreferences_1_34_0,
  store,
} from "./state.ts";

// KOLU_STATE_DIR is set by the `test:unit` script in package.json — state.ts
// reads it at module load.

describe("viewerMode (the 1.36.0 domain key)", () => {
  it("reads `dark` on a store that has never seen a browser", () => {
    // conf merges the `defaults` entry, so a fresh install (and every pre-1.36 file the
    // ladder's rung seeds) resolves an "auto" shuffle exactly as `colorScheme: "dark"`
    // — the equality `resolveNewTerminalPolicy(DEFAULT_PREFERENCES, …)` rests on.
    expect(store.get("viewerMode")).toBe(DEFAULT_PREFERENCES.colorScheme);
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

describe("migratePreferences_1_32_0", () => {
  it("carries rightPanel.collapsed forward into newTerminalCollapsed, strips the stale key, keeps geometry", () => {
    const migrated = migratePreferences_1_32_0({
      newTerminalTheme: "inherit",
      rightPanel: { collapsed: true, size: 0.4, codeTabTreeSize: 0.5 },
    });
    // The old GLOBAL collapse preference is carried forward into the new
    // top-level seed — `true` here, NOT reset to the default `false`. This is
    // the falsifiable carry-forward: a user who kept the panel collapsed keeps
    // it as their new-terminal default across the upgrade.
    expect(migrated.newTerminalCollapsed).toBe(true);
    expect(DEFAULT_PREFERENCES.newTerminalCollapsed).toBe(false); // guards the above from a default flip
    // …the stale per-record collapsed is gone…
    expect(migrated.rightPanel).toEqual({ size: 0.4, codeTabTreeSize: 0.5 });
    expect(migrated.rightPanel).not.toHaveProperty("collapsed");
    // …and unrelated preferences carry through verbatim.
    expect(migrated.newTerminalTheme).toBe("inherit");
  });

  it("preserves an unrelated preference the caller set (spread-defaults never clobber it)", () => {
    const migrated = migratePreferences_1_32_0({
      colorScheme: "light",
      rightPanel: { collapsed: false, size: 0.25, codeTabTreeSize: 0.35 },
    });
    expect(migrated.colorScheme).toBe("light");
    expect(migrated.rightPanel).toEqual({ size: 0.25, codeTabTreeSize: 0.35 });
  });

  it("a record with no rightPanel key backfills the default geometry + top-level seed", () => {
    // No `rightPanel` on the input → the spread-defaults shape backfills the
    // default geometry (never a `collapsed` field, which no longer lives there)
    // and seeds the new top-level default; the caller's field wins.
    const migrated = migratePreferences_1_32_0({ newTerminalTheme: "shuffle" });
    expect(migrated.rightPanel).toEqual(DEFAULT_PREFERENCES.rightPanel);
    expect(migrated.rightPanel).not.toHaveProperty("collapsed");
    expect(migrated.newTerminalCollapsed).toBe(
      DEFAULT_PREFERENCES.newTerminalCollapsed,
    );
    expect(migrated.newTerminalTheme).toBe("shuffle");
  });
});

describe("migratePreferences_1_34_0", () => {
  it("renames activityAlerts → attentionAlerts, carrying the OFF value forward", () => {
    // The falsifiable carry-forward: a user who turned alerts OFF keeps them off
    // across the rename, NOT reset to the `true` default.
    const migrated = migratePreferences_1_34_0({
      activityAlerts: false,
      scrollLock: true,
    });
    expect(migrated.attentionAlerts).toBe(false);
    expect(DEFAULT_PREFERENCES.attentionAlerts).toBe(true); // guards the above from a default flip
    expect(migrated).not.toHaveProperty("activityAlerts");
    // …unrelated preferences carry through verbatim.
    expect(migrated.scrollLock).toBe(true);
  });

  it("carries the ON value forward too", () => {
    const migrated = migratePreferences_1_34_0({ activityAlerts: true });
    expect(migrated.attentionAlerts).toBe(true);
    expect(migrated).not.toHaveProperty("activityAlerts");
  });

  it("leaves an already-migrated record (has attentionAlerts) untouched", () => {
    const fresh = { attentionAlerts: false, scrollLock: true };
    expect(migratePreferences_1_34_0(fresh)).toEqual(fresh);
  });

  it("REPRO: a pre-1.34 blob that never set activityAlerts still gets attentionAlerts", () => {
    // The latent deploy bug: `confStore` reads the raw stored object with NO
    // schema-default back-fill, so a blob that relied on the old default (no
    // `activityAlerts` key) must NOT migrate to a MISSING `attentionAlerts` — that
    // surfaces as `undefined` on the client and silently disables every alert.
    const migrated = migratePreferences_1_34_0({ scrollLock: true });
    expect(typeof migrated.attentionAlerts).toBe("boolean");
    expect(migrated.attentionAlerts).toBe(DEFAULT_PREFERENCES.attentionAlerts);
    expect(migrated.scrollLock).toBe(true);
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
