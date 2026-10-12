/**
 * The boot sweep's REFUSALS, which are the whole safety of a function that
 * calls `rmSync` on directories it found by pattern: a live holder, a home with
 * no gate yet, a home that is not ours, and a name this app never mints all
 * survive; only a home whose own gate proves its owner is gone is removed.
 *
 * No process is forked. The two pids the sweep has to judge are available for
 * free: `process.pid` is alive by construction, and a pid above every platform's
 * `pid_max` can never name a process.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { reapStaleDaemonHomes } from "./staleHomes.ts";

/** Above Linux's maximum `pid_max` (2^22) and macOS's (99998), so `kill(pid, 0)`
 *  can only ever answer "no such process" — a dead holder with nothing to fork
 *  and nothing to race. */
const DEAD_PID = 2_147_483_647;

const scratchDirs: string[] = [];
let savedXdg: string | undefined;

/** One app home under the pinned XDG drawer, 0700 like the real thing. */
function seedHome(root: string, name: string, gate?: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (gate !== undefined) writeFileSync(join(dir, "padi.pid"), gate);
  return dir;
}

beforeEach(() => {
  savedXdg = process.env.XDG_RUNTIME_DIR;
  const root = mkdtempSync(join(tmpdir(), "stale-homes-"));
  scratchDirs.push(root);
  process.env.XDG_RUNTIME_DIR = root;
});

afterEach(() => {
  if (savedXdg === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = savedXdg;
  for (const d of scratchDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

it("removes a home whose gate names a dead holder, and keeps a live one", () => {
  const root = process.env.XDG_RUNTIME_DIR!;
  const corpse = seedHome(root, "padi-deadbeef", String(DEAD_PID));
  const alive = seedHome(root, "padi-cafebabe", String(process.pid));

  const sweep = reapStaleDaemonHomes({ app: "padi", gateFile: "padi.pid" });

  expect(sweep.removed).toEqual([corpse]);
  expect(existsSync(corpse)).toBe(false);
  expect(existsSync(alive)).toBe(true);
  expect(sweep.skipped).toContainEqual({ dir: alive, why: "live" });
});

it("keeps a GATELESS home — that is also what a daemon mid-boot looks like", () => {
  const root = process.env.XDG_RUNTIME_DIR!;
  const booting = seedHome(root, "padi-0ddba11");

  const sweep = reapStaleDaemonHomes({ app: "padi", gateFile: "padi.pid" });

  expect(sweep.removed).toEqual([]);
  expect(existsSync(booting)).toBe(true);
  expect(sweep.skipped).toContainEqual({ dir: booting, why: "no-gate" });
});

it("keeps a home that is not owner-only, however dead its gate looks", () => {
  const root = process.env.XDG_RUNTIME_DIR!;
  const shared = seedHome(root, "padi-feedface", String(DEAD_PID));
  // Group/other bits — the same boundary the serving side refuses to bind under.
  chmodSync(shared, 0o755);

  const sweep = reapStaleDaemonHomes({ app: "padi", gateFile: "padi.pid" });

  expect(sweep.removed).toEqual([]);
  expect(existsSync(shared)).toBe(true);
  expect(sweep.skipped).toContainEqual({ dir: shared, why: "not-ours" });
});

it("removes a MALFORMED gate's home (the pid-gate law's own verdict) and ignores foreign names", () => {
  const root = process.env.XDG_RUNTIME_DIR!;
  const garbage = seedHome(root, "padi-badf00d", "not-a-pid\n");
  // Not a name this app mints — a sweep for `padi` must not reach another
  // daemon's home even with a dead gate beside it.
  const foreign = seedHome(root, "kaval-deadbeef", String(DEAD_PID));

  const sweep = reapStaleDaemonHomes({ app: "padi", gateFile: "padi.pid" });

  expect(sweep.removed).toEqual([garbage]);
  expect(existsSync(foreign)).toBe(true);
});
