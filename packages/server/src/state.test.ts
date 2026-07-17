import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  backfillLocation,
  backfillRemoteUrl,
  backfillTerminalState,
  LOCAL_LOCATION,
} from "@kolu/padi/surface";
import Conf from "conf";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  getClientId,
  migratePreferences_1_30_0,
  migratePreferences_1_32_0,
  mintClientIdIfAbsent,
} from "./state.ts";

// KOLU_STATE_DIR is set by the `test:unit` script in package.json — state.ts
// reads it at module load.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Open a bare `Conf` under a throwaway dir — enough surface for
 *  `mintClientIdIfAbsent` (which touches only `get`/`set` on `clientId`). Cast to the
 *  helper's param type without needing the module-internal `PersistedState` export. */
function openStore(cwd: string): Parameters<typeof mintClientIdIfAbsent>[0] {
  // Mirror the module singleton's construction: `cwd` only ⇒ the store lives at
  // `<cwd>/config.json` (conf's default `configName`), exactly where state.ts writes.
  return new Conf({ cwd }) as unknown as Parameters<
    typeof mintClientIdIfAbsent
  >[0];
}

function freshStateDir(): string {
  return mkdtempSync(join(tmpdir(), "kolu-clientid-test-"));
}

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

describe("getClientId (module singleton)", () => {
  it("returns a valid UUID and is stable within a boot (same value every call)", () => {
    const first = getClientId();
    expect(first).toMatch(UUID_RE);
    // Idempotent: the persisted value, not a fresh mint, on every subsequent call.
    expect(getClientId()).toBe(first);
  });
});

describe("mintClientIdIfAbsent", () => {
  it("mints a valid UUID on first read and is idempotent thereafter", () => {
    const store = openStore(freshStateDir());
    const minted = mintClientIdIfAbsent(store);
    expect(minted).toMatch(UUID_RE);
    // Second call reads the persisted value, never re-mints.
    expect(mintClientIdIfAbsent(store)).toBe(minted);
  });

  it("is STABLE across a restart — a fresh store-open on the same dir returns the SAME id", () => {
    // The re-attach guarantee: an ephemeral id would orphan a client's remote
    // estate on every restart, so the persisted value must survive a store re-open.
    const dir = freshStateDir();
    const minted = mintClientIdIfAbsent(openStore(dir));
    // Simulate a server restart: a brand-new Conf pointed at the same KOLU_STATE_DIR.
    const afterRestart = mintClientIdIfAbsent(openStore(dir));
    expect(afterRestart).toBe(minted);
  });

  it("mints DIFFERENT ids for DIFFERENT dirs (different clients → different estates)", () => {
    const a = mintClientIdIfAbsent(openStore(freshStateDir()));
    const b = mintClientIdIfAbsent(openStore(freshStateDir()));
    expect(a).toMatch(UUID_RE);
    expect(b).toMatch(UUID_RE);
    expect(a).not.toBe(b);
  });

  it("does NOT throw on a pre-existing file lacking clientId (an upgrade), and mints one", () => {
    // A file written before the field existed: `preferences` + `hosts`, no `clientId`.
    const dir = freshStateDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ preferences: DEFAULT_PREFERENCES, hosts: [] }),
    );
    const store = openStore(dir);
    // Pre-condition: the store really has no clientId to read.
    expect(store.get("clientId")).toBeUndefined();
    // The lazy-mint path must be safe on a predates-the-field file: no throw, a UUID out.
    const minted = mintClientIdIfAbsent(store);
    expect(minted).toMatch(UUID_RE);
    // And it persisted — a re-open sees the same value (the upgrade is durable).
    expect(mintClientIdIfAbsent(openStore(dir))).toBe(minted);
  });

  it("FAILS LOUD on a present-but-invalid clientId — never re-mints (that would orphan the estate)", () => {
    // A corrupt/hand-blanked identity is NOT silently repaired: re-minting would
    // change the estate key and orphan this client's remote terminals, so it throws
    // (the same fail-fast discipline getPersistedHosts applies to a corrupt hosts value).
    for (const bad of ["", "not-a-uuid", "1234"]) {
      const dir = freshStateDir();
      writeFileSync(
        join(dir, "config.json"),
        JSON.stringify({
          preferences: DEFAULT_PREFERENCES,
          hosts: [],
          clientId: bad,
        }),
      );
      expect(() => mintClientIdIfAbsent(openStore(dir))).toThrow(
        /clientId .* not a valid UUID|refusing to re-mint/,
      );
    }
  });
});
