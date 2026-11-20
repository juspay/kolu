import {
  backfillLocation,
  backfillRemoteUrl,
  backfillTerminalState,
  LOCAL_LOCATION,
} from "@kolu/padi-client/surface";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { store } from "./state.ts";
import {
  migratePreferences_1_30_0,
  migratePreferences_1_32_0,
  migratePreferences_1_34_0,
  migratePreferences_1_37_0,
  migratePreferences_1_38_0,
  migratePreferences_1_39_0,
  migratePreferences_1_40_0,
  migratePreferences_1_41_0,
  migratePreferences_1_42_0,
  migratePreferences_1_43_0,
} from "./stateLadder.ts";

describe("viewerMode (the 1.36.0 domain key)", () => {
  it("reads `dark` on a store that has never seen a browser", () => {
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
    expect(migrated.newTerminalCollapsed).toBe(true);
    expect(DEFAULT_PREFERENCES.newTerminalCollapsed).toBe(false);
    expect(migrated.rightPanel).toEqual({ size: 0.4, codeTabTreeSize: 0.5 });
    expect(migrated.rightPanel).not.toHaveProperty("collapsed");
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
    const migrated = migratePreferences_1_34_0({
      activityAlerts: false,
      scrollLock: true,
    });
    expect(migrated.attentionAlerts).toBe(false);
    expect(DEFAULT_PREFERENCES.attentionAlerts).toBe(true);
    expect(migrated).not.toHaveProperty("activityAlerts");
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
    const migrated = migratePreferences_1_34_0({ scrollLock: true });
    expect(typeof migrated.attentionAlerts).toBe("boolean");
    expect(migrated.attentionAlerts).toBe(DEFAULT_PREFERENCES.attentionAlerts);
    expect(migrated.scrollLock).toBe(true);
  });
});

describe("migratePreferences_1_38_0 — never chosen is the absence of a value", () => {
  const prefs = (agentDistro?: unknown): Record<string, unknown> => {
    const { agentDistro: _drop, ...rest } = DEFAULT_PREFERENCES;
    return agentDistro === undefined ? rest : { ...rest, agentDistro };
  };

  it("an absent agentDistro stays absent (1.37 seeds it first)", () => {
    expect(migratePreferences_1_38_0(prefs())).toEqual(prefs());
    expect(
      migratePreferences_1_38_0(migratePreferences_1_37_0(prefs())).agentDistro,
    ).toBeNull();
  });

  it("an Off record becomes null — whatever profile it remembered", () => {
    for (const profile of ["vanilla", "juspay"])
      expect(
        migratePreferences_1_38_0(prefs({ enabled: false, profile })),
      ).toEqual(prefs(null));
  });

  it("an On record is kept whole", () => {
    const on = prefs({ enabled: true, profile: "juspay" });
    expect(migratePreferences_1_38_0(on)).toEqual(on);
  });

  it("is a no-op on an already-migrated (null) record", () => {
    expect(migratePreferences_1_38_0(prefs(null))).toEqual(prefs(null));
  });
});

describe("migratePreferences_1_39_0 — the tile tip's size", () => {
  const { tipBarCollapsed: _drop, ...pre } = DEFAULT_PREFERENCES;

  it("seeds the full bar onto a record that has no size", () => {
    expect(migratePreferences_1_39_0(pre)).toEqual({
      ...pre,
      tipBarCollapsed: false,
    });
  });

  it("never resets a stored size", () => {
    const collapsed = { ...pre, tipBarCollapsed: true };
    expect(migratePreferences_1_39_0(collapsed)).toEqual(collapsed);
  });
});

describe("migratePreferences_1_40_0 — remembered profiles, and juspay becomes a reference", () => {
  const { agentProfilesRecent: _drop, ...pre } = DEFAULT_PREFERENCES;

  it("seeds an empty list onto a record that has none, and keeps a stored one", () => {
    expect(migratePreferences_1_40_0(pre)).toEqual({
      ...pre,
      agentProfilesRecent: [],
    });
    const kept = { ...pre, agentProfilesRecent: ["github:me/p"] };
    expect(migratePreferences_1_40_0(kept)).toEqual(kept);
  });

  it("a stored juspay, on or off, becomes github:juspay/skills; any other is kept", () => {
    for (const enabled of [true, false])
      expect(
        migratePreferences_1_40_0({
          ...pre,
          agentDistro: { enabled, profile: "juspay" },
        }).agentDistro,
      ).toEqual({ enabled, profile: "github:juspay/skills" });
    const vanilla = {
      ...pre,
      agentDistro: { enabled: true, profile: "vanilla" },
    };
    expect(migratePreferences_1_40_0(vanilla).agentDistro).toEqual(
      vanilla.agentDistro,
    );
    expect(migratePreferences_1_40_0(pre).agentDistro).toBeNull();
  });
});

describe("migratePreferences_1_41_0 — one profile becomes the stack", () => {
  const base = { ...DEFAULT_PREFERENCES } as Record<string, unknown>;
  const stored = (agentDistro: unknown) =>
    migratePreferences_1_41_0({ ...base, agentDistro }).agentDistro;

  it("vanilla (the harnesses alone) becomes the empty stack, on or off", () => {
    for (const enabled of [true, false])
      expect(stored({ enabled, profile: "vanilla" })).toEqual({
        enabled,
        profiles: [],
      });
  });

  it("any other profile becomes the stack's one entry, on or off", () => {
    for (const enabled of [true, false])
      expect(stored({ enabled, profile: "github:me/p" })).toEqual({
        enabled,
        profiles: ["github:me/p"],
      });
    expect(stored({ enabled: true, profile: "~/my-profile" })).toEqual({
      enabled: true,
      profiles: ["~/my-profile"],
    });
  });

  it("never chosen (null) stays null, and the rest of the record is kept", () => {
    expect(stored(null)).toBeNull();
    const pre = { ...base, agentDistro: null, seenTips: ["x"] };
    expect(migratePreferences_1_41_0(pre)).toEqual(pre);
  });

  it("a record already in the new shape is returned untouched", () => {
    const current = {
      ...base,
      agentDistro: { enabled: true, profiles: ["a", "b"] },
    };
    expect(migratePreferences_1_41_0(current)).toBe(current);
  });

  it("only agentDistro moves", () => {
    const pre = {
      ...base,
      agentProfilesRecent: ["github:me/p"],
      agentDistro: { enabled: true, profile: "github:me/p" },
    };
    expect(migratePreferences_1_41_0(pre)).toEqual({
      ...pre,
      agentDistro: { enabled: true, profiles: ["github:me/p"] },
    });
  });
});

describe("migratePreferences_1_42_0 — Juspay leaves the stack: it is opt-in", () => {
  const base = { ...DEFAULT_PREFERENCES } as Record<string, unknown>;
  const JUSPAY = "github:juspay/skills";

  it("takes Juspay's reference out of the stack and the remembered references, keeping the rest in order", () => {
    expect(
      migratePreferences_1_42_0({
        ...base,
        agentDistro: {
          enabled: true,
          profiles: ["~/a", JUSPAY, "github:me/p"],
        },
        agentProfilesRecent: [JUSPAY, "~/a"],
      }),
    ).toMatchObject({
      agentDistro: { enabled: true, profiles: ["~/a", "github:me/p"] },
      agentProfilesRecent: ["~/a"],
    });
  });

  it("a stack of Juspay alone becomes empty; never chosen stays null", () => {
    expect(
      migratePreferences_1_42_0({
        ...base,
        agentDistro: { enabled: true, profiles: [JUSPAY] },
      }).agentDistro,
    ).toEqual({ enabled: true, profiles: [] });
    expect(
      migratePreferences_1_42_0({ ...base, agentDistro: null }).agentDistro,
    ).toBeNull();
  });
});

describe("the CHAINED preference ladder (a pre-1.30 blob walking every rung)", () => {
  const walkLadder = (blob: Record<string, unknown>) =>
    migratePreferences_1_43_0(
      migratePreferences_1_42_0(
        migratePreferences_1_41_0(
          migratePreferences_1_40_0(
            migratePreferences_1_39_0(
              migratePreferences_1_38_0(
                migratePreferences_1_37_0(
                  migratePreferences_1_34_0(
                    migratePreferences_1_32_0(migratePreferences_1_30_0(blob)),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

  const pre_1_30 = (alerts?: boolean): Record<string, unknown> => ({
    seenTips: ["shuffle"],
    startupTips: true,
    shuffleTheme: false,
    scrollLock: true,
    ...(alerts !== undefined && { activityAlerts: alerts }),
    colorScheme: "dark",
    terminalRenderer: "auto",
    rightPanel: { collapsed: true, size: 0.25, codeTabTreeSize: 0.35 },
  });

  it("an OFF activityAlerts survives the full walk (the defaults spread must not outrank it)", () => {
    const migrated = walkLadder(pre_1_30(false));
    expect(migrated.attentionAlerts).toBe(false);
    expect(DEFAULT_PREFERENCES.attentionAlerts).toBe(true);
    expect(migrated).not.toHaveProperty("activityAlerts");
    expect(migrated.newTerminalTheme).toBe("inherit");
    expect(migrated.newTerminalCollapsed).toBe(true);
  });

  it("an ON activityAlerts survives the full walk too", () => {
    const migrated = walkLadder(pre_1_30(true));
    expect(migrated.attentionAlerts).toBe(true);
    expect(migrated).not.toHaveProperty("activityAlerts");
  });

  it("a pre-1.43 file reaches the strip with NO arrangement — pool order stands", () => {
    expect(walkLadder(pre_1_30()).hostOrder).toEqual([]);
    expect(
      migratePreferences_1_43_0({ hostOrder: ["remote:zest"] }).hostOrder,
    ).toEqual(["remote:zest"]);
  });

  it("a 1.37-era Agents choice walks the agent rungs into the stack", () => {
    const walkAgents = (agentDistro: unknown) =>
      migratePreferences_1_42_0(
        migratePreferences_1_41_0(
          migratePreferences_1_40_0(
            migratePreferences_1_39_0(
              migratePreferences_1_38_0({ ...pre_1_30(), agentDistro }),
            ),
          ),
        ),
      ).agentDistro;
    expect(walkAgents({ enabled: true, profile: "juspay" })).toEqual({
      enabled: true,
      profiles: [],
    });
    expect(walkAgents({ enabled: true, profile: "vanilla" })).toEqual({
      enabled: true,
      profiles: [],
    });
    expect(walkAgents({ enabled: false, profile: "vanilla" })).toBeNull();
    expect(walkLadder(pre_1_30()).agentDistro).toBeNull();
  });

  it("a blob that never set activityAlerts lands on the default", () => {
    const migrated = walkLadder(pre_1_30());
    expect(migrated.attentionAlerts).toBe(DEFAULT_PREFERENCES.attentionAlerts);
    expect(migrated).not.toHaveProperty("activityAlerts");
  });
});

describe("backfillRemoteUrl", () => {
  it("backfills remoteUrl: null on an already-migrated git record missing the field", () => {
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
