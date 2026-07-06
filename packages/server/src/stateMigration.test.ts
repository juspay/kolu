/**
 * The 1.31.0 BURIAL migration — `stripLegacyStateKeys_1_31_0` — driven against a
 * real `Conf` under an ephemeral temp dir. Two invariants:
 *   (i)  a file WITH legacy keys is BACKED UP (`.pre-1.31-strip.bak` retains
 *        them) before the live file is stripped to just `preferences`;
 *   (ii) a file WITHOUT legacy keys grows no `.bak` (harmless-if-absent).
 *
 * BACKUP-FIRST is load-bearing: a direct pre-W2.2 → W2.3 upgrade runs this strip
 * before a fresh padi imports the legacy session, so the copy is the recovery
 * path if the strip runs first.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Conf from "conf";
import { DEFAULT_PREFERENCES } from "kolu-common/surface";
import { afterEach, describe, expect, it } from "vitest";
// Importing state.ts opens its own throwaway store at the test harness's
// KOLU_STATE_DIR (set by the `test:unit` script) — unrelated to the fixtures
// below, which each build their own Conf under a fresh temp dir.
import {
  moveRecentHostsOutOfPreferences_1_32_0,
  stripLegacyStateKeys_1_31_0,
  validatePersistedState,
} from "./state.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A real `Conf` under a fresh temp dir, seeded with `preferences` plus whatever
 *  extra (legacy) keys the case wants on disk. */
function makeStore(
  extra: Record<string, unknown>,
): Conf<Record<string, unknown>> {
  const dir = mkdtempSync(join(tmpdir(), "kolu-burial-"));
  dirs.push(dir);
  const conf = new Conf<Record<string, unknown>>({
    cwd: dir,
    projectVersion: "1.31.0",
    defaults: { preferences: DEFAULT_PREFERENCES },
  });
  for (const [key, value] of Object.entries(extra)) conf.set(key, value);
  return conf;
}

const readJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path, "utf8"));

describe("stripLegacyStateKeys_1_31_0", () => {
  it("backs up then strips a file carrying the legacy keys", () => {
    const conf = makeStore({
      session: { active: null, terminals: [{ id: "t1" }] },
      activityFeed: { recentRepos: ["/repo"], recentAgents: [] },
      sleepingTerminals: [{ id: "s1" }],
      lastPairedDaemon: { stateRoot: "/root" },
    });
    const bakPath = `${conf.path}.pre-1.31-strip.bak`;

    stripLegacyStateKeys_1_31_0(conf as never);

    // (i) the backup retains every legacy key verbatim...
    expect(existsSync(bakPath)).toBe(true);
    const bak = readJson(bakPath);
    expect(bak.session).toEqual({ active: null, terminals: [{ id: "t1" }] });
    expect(bak.activityFeed).toEqual({
      recentRepos: ["/repo"],
      recentAgents: [],
    });
    expect(bak.sleepingTerminals).toEqual([{ id: "s1" }]);
    expect(bak.lastPairedDaemon).toEqual({ stateRoot: "/root" });

    // ...and the live file has them stripped, keeping only `preferences`.
    const live = readJson(conf.path);
    expect(live.preferences).toBeDefined();
    expect(live.session).toBeUndefined();
    expect(live.activityFeed).toBeUndefined();
    expect(live.sleepingTerminals).toBeUndefined();
    expect(live.lastPairedDaemon).toBeUndefined();
    expect(conf.has("session" as never)).toBe(false);
  });

  it("creates no .bak for a file without any legacy key", () => {
    const conf = makeStore({});
    const bakPath = `${conf.path}.pre-1.31-strip.bak`;

    stripLegacyStateKeys_1_31_0(conf as never);

    expect(existsSync(bakPath)).toBe(false);
    expect(readJson(conf.path).preferences).toBeDefined();
  });

  it("preserves the FULL first backup across a partial-strip rerun (write-once)", () => {
    // Simulate a crash mid-strip: the first run backs up the whole file, then the
    // process dies after deleting only `session` (conf persists each delete
    // synchronously but records the migration as done only when the handler
    // returns, so the ladder reruns). The second run must NOT re-copy the now
    // session-less live file over the full first backup.
    const conf = makeStore({
      session: { active: null, terminals: [{ id: "t1" }] },
      activityFeed: { recentRepos: ["/repo"], recentAgents: [] },
      sleepingTerminals: [{ id: "s1" }],
      lastPairedDaemon: { stateRoot: "/root" },
    });
    const bakPath = `${conf.path}.pre-1.31-strip.bak`;

    // First (partial) run: back up, then lose `session` from the live file only.
    stripLegacyStateKeys_1_31_0(conf as never);
    expect(existsSync(bakPath)).toBe(true);
    // The live file is now stripped; re-seed the residual legacy keys the crash
    // left behind so the rerun still sees legacy state (hence `hasLegacy`).
    conf.set("activityFeed", { recentRepos: ["/repo"], recentAgents: [] });
    conf.set("sleepingTerminals", [{ id: "s1" }]);
    conf.set("lastPairedDaemon", { stateRoot: "/root" });

    // Second (rerun) run: sees legacy keys but MUST keep the full first backup.
    stripLegacyStateKeys_1_31_0(conf as never);

    const bak = readJson(bakPath);
    // The zero-loss guarantee: `session` — deleted from the live file on the first
    // run — still survives verbatim in the backup padi imports from.
    expect(bak.session).toEqual({ active: null, terminals: [{ id: "t1" }] });
    expect(bak.activityFeed).toEqual({
      recentRepos: ["/repo"],
      recentAgents: [],
    });
  });
});

describe("moveRecentHostsOutOfPreferences_1_32_0 (D1)", () => {
  function fakeStore(initial: Record<string, unknown>) {
    const data = { ...initial };
    return {
      data,
      get: (key: "preferences") => data[key] as Record<string, unknown>,
      set: (key: "recentHosts" | "preferences", value: unknown) => {
        data[key] = value;
      },
    };
  }

  it("moves a branch-runner's preferences.recentHosts into its OWN top-level key + strips it", () => {
    const store = fakeStore({
      preferences: { seenTips: [], recentHosts: ["zest", "box2"] },
    });
    moveRecentHostsOutOfPreferences_1_32_0(store);
    expect(store.data.recentHosts).toEqual(["zest", "box2"]); // moved to its own key
    expect(store.data.preferences).toEqual({ seenTips: [] }); // stripped from preferences
  });

  it("is a no-op for a fresh user whose preferences never carried recentHosts", () => {
    const store = fakeStore({ preferences: { seenTips: [] } });
    moveRecentHostsOutOfPreferences_1_32_0(store);
    expect(store.data.recentHosts).toBeUndefined(); // untouched → defaults to [] via conf
    expect(store.data.preferences).toEqual({ seenTips: [] });
  });
});

describe("validatePersistedState (D1 — no schema key silently omitted)", () => {
  it("validates a store whose recentHosts exists only via the conf default (no top-level key on disk)", () => {
    // A pre-D1 state file: preferences on disk, NO top-level recentHosts. The conf
    // default supplies `[]` for the absent key. A hand-built parse object that omitted
    // recentHosts (the bug this guards) would red here instead of reading the default.
    const disk: Partial<Record<"preferences" | "recentHosts", unknown>> = {
      preferences: DEFAULT_PREFERENCES,
    };
    const confDefaults: Record<"preferences" | "recentHosts", unknown> = {
      preferences: DEFAULT_PREFERENCES,
      recentHosts: [],
    };
    const result = validatePersistedState((key) =>
      key in disk ? disk[key] : confDefaults[key],
    );
    expect(result.success).toBe(true);
  });
});
