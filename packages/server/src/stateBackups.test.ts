/**
 * The server face of the state-backup ring (#1658): the list's summary, the
 * scratch-copy decode that walks the REAL migration ladder on an old snapshot,
 * and the restore orchestration — cells written, pool converged (adds and
 * removes both), an already-live host skipped rather than re-added, and the
 * hosts that would not converge NAMED in the answer rather than collapsing to
 * either a silent success or a "restore failed" that contradicts what applied.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeHostKey } from "kolu-common/hostKey";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { afterEach, describe, expect, it } from "vitest";
import { decodeStateBackup, stateBackupRing, store } from "./state.ts";
import {
  listServerStateBackups,
  type RestoreServerStateBackupDeps,
  restoreServerStateBackup,
} from "./stateBackups.ts";

// Canonical encoded guest keys — `hosts` is schema-validated on decode, so the
// fixtures must be real encodings, not ad-hoc strings.
const remote = (target: string) => encodeHostKey({ kind: "remote", target });
const KEEP = remote("zest-keep");
const FROM_BACKUP = remote("zest-from-backup");
const STALE = remote("zest-stale");
const GONE = remote("zest-gone");
const HOST_A = remote("zest-a");
const HOST_B = remote("zest-b");

// The module-level `store` is a process-wide singleton shared with
// `state.test.ts` (the suites run serially in one process) — put back every
// key a fixture wrote so the sibling suite still sees a virgin store.
afterEach(() => {
  store.set("preferences", DEFAULT_PREFERENCES);
  store.set("hosts", []);
  store.set("viewerMode", "dark");
});

/** Snapshot the CURRENT live store into the ring and hand back the file name. */
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

/** Restore deps that record every write instead of performing one. `live` is the
 *  pool's LIVE membership, which the persisted baseline need not equal (an env
 *  seed is live-but-unpersisted). */
function recordingDeps(
  current: readonly string[],
  live: readonly string[] = [],
) {
  const calls = {
    preferences: [] as unknown[],
    viewerMode: [] as unknown[],
    added: [] as string[],
    removed: [] as string[],
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
  };
  return { calls, deps };
}

describe("listServerStateBackups", () => {
  it("summarizes each snapshot with its fleet size", () => {
    store.set("hosts", [
      encodeHostKey({ kind: "remote", target: "zest" }),
      encodeHostKey({ kind: "remote", target: "mist" }),
    ]);
    const file = takeSnapshot();
    const entry = listServerStateBackups().backups.find((b) => b.file === file);
    expect(entry?.summary).toEqual({ kind: "state", hosts: 2 });
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
    // A pre-1.34 snapshot: `activityAlerts` not yet renamed, no `hosts` /
    // `viewerMode` keys yet. The scratch decode must carry the user's OFF
    // through the 1.34 rename and seed the missing domains — the live store
    // stays untouched throughout.
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

    // The pool now holds `keep` + `stale`; the snapshot says `keep` +
    // `from-backup` — so restore must add one and remove the other.
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

  it("skips a host that is LIVE but unpersisted — an env seed is not a failed add", async () => {
    store.set("hosts", [FROM_BACKUP]);
    const file = takeSnapshot();
    // The snapshot names a host the pool already carries as a declarative
    // `KOLU_PADI_HOST` seed: it is absent from the persisted baseline but live,
    // so `pool.add` would throw "host already exists" and the restore would
    // report a failure that never happened.
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
    // A partial convergence is an ANSWER, not a throw: the cells DID apply, and
    // telling the user "Restore failed" about that contradicts what they see.
    const result = await restoreServerStateBackup({ file }, deps);
    expect(result.hostFailures).toHaveLength(2);
    expect(result.hostFailures.join("; ")).toMatch(
      /no route to .*zest-a.*no route to .*zest-b/s,
    );
    // The remove half still ran — every diff was attempted.
    expect(calls.removed).toEqual([GONE]);
  });

  it("refuses a non-ring file name outright", async () => {
    const { deps } = recordingDeps([]);
    await expect(
      restoreServerStateBackup({ file: "../../etc/passwd" }, deps),
    ).rejects.toThrow(/not a state-backup file name/);
  });
});
