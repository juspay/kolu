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
import { stripLegacyStateKeys_1_31_0 } from "./state.ts";

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
});
