import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeHostKey } from "kolu-common/hostKey";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { afterEach, describe, expect, it } from "vitest";
import type { PersistedMembers, PersistedWorks } from "kolu-conductor";
import { workIdOf } from "kolu-work";
import { decodeStateBackup, stateBackupRing, store } from "./state.ts";
import {
  listServerStateBackups,
  type RestoreServerStateBackupDeps,
  restoreServerStateBackup,
} from "./stateBackups.ts";

const remote = (target: string) => encodeHostKey({ kind: "remote", target });
const KEEP = remote("zest-keep");
const FROM_BACKUP = remote("zest-from-backup");
const STALE = remote("zest-stale");
const GONE = remote("zest-gone");
const HOST_A = remote("zest-a");
const HOST_B = remote("zest-b");
const AT = "2026-01-01T00:00:00.000Z";

afterEach(() => {
  store.set("preferences", DEFAULT_PREFERENCES);
  store.set("hosts", []);
  store.set("viewerMode", "dark");
  store.set("works", {});
  store.set("members", {});
});

function takeSnapshot(): string {
  const outcome = stateBackupRing.snapshot();
  if (outcome.kind !== "created" && outcome.kind !== "unchanged") {
    throw new Error(`snapshot did not land: ${outcome.kind}`);
  }
  if (outcome.kind === "created") return outcome.file;
  const newest = listServerStateBackups().backups[0];
  if (!newest) throw new Error("unchanged snapshot but empty ring");
  return newest.file;
}

function recordingDeps(
  current: readonly string[],
  live: readonly string[] = [],
) {
  const calls = {
    preferences: [] as unknown[],
    viewerMode: [] as unknown[],
    added: [] as string[],
    removed: [] as string[],
    works: [] as PersistedWorks[],
    members: [] as PersistedMembers[],
  };
  const deps: RestoreServerStateBackupDeps = {
    setPreferences: (v) => calls.preferences.push(v),
    setViewerMode: (v) => calls.viewerMode.push(v),
    currentHostKeys: () => current,
    hasLiveHost: (key) => live.includes(key),
    addHostKey: async (key) => {
      calls.added.push(key);
    },
    removeHostKey: async (key) => {
      calls.removed.push(key);
    },
    restoreWorks: (works, members) => {
      calls.works.push(works);
      calls.members.push(members);
    },
  };
  return { calls, deps };
}

function storedWork(branch: string, name: string): PersistedWorks {
  const key = {
    kind: "branch",
    host: "local",
    repo: "/srv/repo",
    branch,
  } as const;
  return {
    [workIdOf(key)]: {
      key,
      title: name,
      startedAt: AT,
      decisions: [],
      events: [
        {
          at: AT,
          by: "you",
          kind: "requested",
          about: { kind: "work" },
          request: { kind: "said", text: name },
        },
        {
          at: AT,
          by: "kolu",
          kind: "joined",
          about: { kind: "member", terminal: "local/t1" },
          role: "implementor",
        },
      ],
      state: { kind: "open" },
    },
  };
}

function storedMembers(branch: string, name: string): PersistedMembers {
  return {
    "local/t1": {
      work: workIdOf({
        kind: "branch",
        host: "local",
        repo: "/srv/repo",
        branch,
      }),
      role: "implementor",
      joinedAt: AT,
      worktree: { kind: "unread" },
      watch: {
        name,
        agent: null,
        told: null,
        joined: "created",
        spoken: false,
        ran: false,
      },
    },
  };
}

describe("listServerStateBackups", () => {
  it("summarizes each snapshot with its fleet size", () => {
    store.set("hosts", [
      encodeHostKey({ kind: "remote", target: "zest" }),
      encodeHostKey({ kind: "remote", target: "mist" }),
    ]);
    const file = takeSnapshot();
    const entry = listServerStateBackups().backups.find((b) => b.file === file);
    expect(entry?.summary).toEqual({ kind: "state", hosts: 2, works: 0 });
  });

  it("lists an unparseable snapshot as unreadable instead of collapsing", () => {
    const dir = stateBackupRing.dir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.1999-01-01T00-00-00-000Z.json"), "{nope");
    const entry = listServerStateBackups().backups.find(
      (b) => b.file === "config.1999-01-01T00-00-00-000Z.json",
    );
    expect(entry?.summary).toEqual({ kind: "unreadable" });
  });
});

describe("decodeStateBackup", () => {
  it("walks the real migration ladder on an old snapshot (scratch copy)", () => {
    const before = JSON.stringify(store.store);
    const decoded = decodeStateBackup(
      {
        preferences: { ...DEFAULT_PREFERENCES, activityAlerts: false },
        __internal__: { migrations: { version: "1.33.0" } },
      },
      "old-snapshot",
    );
    expect(decoded.preferences.attentionAlerts).toBe(false);
    expect(decoded.hosts).toEqual([]);
    expect(decoded.viewerMode).toBe("dark");
    expect(JSON.stringify(store.store)).toBe(before);
  });

  it("throws on a snapshot that cannot decode (fail-fast, nothing applied)", () => {
    expect(() =>
      decodeStateBackup(
        {
          preferences: "not a record",
          __internal__: { migrations: { version: "1.36.0" } },
        },
        "bad-snapshot",
      ),
    ).toThrow();
  });
});

describe("restoreServerStateBackup", () => {
  it("writes both cells and converges the pool in both directions", async () => {
    store.set("preferences", {
      ...DEFAULT_PREFERENCES,
      scrollLock: false,
    });
    store.set("hosts", [KEEP, FROM_BACKUP]);
    store.set("viewerMode", "light");
    const file = takeSnapshot();

    const { calls, deps } = recordingDeps([KEEP, STALE]);
    expect(await restoreServerStateBackup({ file }, deps)).toEqual({
      hostFailures: [],
    });
    expect(calls.preferences).toEqual([
      { ...DEFAULT_PREFERENCES, scrollLock: false },
    ]);
    expect(calls.viewerMode).toEqual(["light"]);
    expect(calls.added).toEqual([FROM_BACKUP]);
    expect(calls.removed).toEqual([STALE]);
  });

  it("hands the snapshot's WORKS to the live conductor, which is their one writer", async () => {
    store.set("works", storedWork("work-from-backup", "last week's work"));
    store.set("members", storedMembers("work-from-backup", "last week's work"));
    const file = takeSnapshot();
    store.set("works", storedWork("work-today", "today's work"));

    const { calls, deps } = recordingDeps([]);
    await restoreServerStateBackup({ file }, deps);
    expect(calls.works).toHaveLength(1);
    expect(Object.keys(calls.works[0] ?? {})).toEqual(
      Object.keys(storedWork("work-from-backup", "last week's work")),
    );
    expect(calls.works[0]).toEqual(
      storedWork("work-from-backup", "last week's work"),
    );
    expect(calls.members[0]).toEqual(
      storedMembers("work-from-backup", "last week's work"),
    );
  });

  it("skips a host that is LIVE but unpersisted — an env seed is not a failed add", async () => {
    store.set("hosts", [FROM_BACKUP]);
    const file = takeSnapshot();
    const { calls, deps } = recordingDeps([], [FROM_BACKUP]);
    const result = await restoreServerStateBackup({ file }, deps);
    expect(calls.added).toEqual([]);
    expect(result.hostFailures).toEqual([]);
  });

  it("names the hosts that would not converge, after attempting every diff", async () => {
    store.set("hosts", [HOST_A, HOST_B]);
    const file = takeSnapshot();
    const { calls, deps } = recordingDeps([GONE]);
    deps.addHostKey = async (key) => {
      throw new Error(`no route to ${key}`);
    };
    const result = await restoreServerStateBackup({ file }, deps);
    expect(result.hostFailures).toHaveLength(2);
    expect(result.hostFailures.join("; ")).toMatch(
      /no route to .*zest-a.*no route to .*zest-b/s,
    );
    expect(calls.removed).toEqual([GONE]);
  });

  it("refuses a non-ring file name outright", async () => {
    const { deps } = recordingDeps([]);
    await expect(
      restoreServerStateBackup({ file: "../../etc/passwd" }, deps),
    ).rejects.toThrow(/not a state-backup file name/);
  });
});
