/**
 * The boot sweep's REFUSALS, which are the whole safety of a function that
 * calls `rmSync` on directories it found by pattern: a live holder, a home with
 * no gate yet, a home that is not ours, and a name this app never mints all
 * survive; only a home whose own gate proves its owner is gone is removed.
 *
 * No process is forked. The two pids the sweep has to judge are available for
 * free: `process.pid` is alive by construction, and a pid above every platform's
 * `pid_max` can never name a process.
 *
 * And nothing ambient is touched: every case hands the sweep ITS OWN scratch
 * drawer as `runtimeRoots`. An earlier draft pinned `$XDG_RUNTIME_DIR` instead
 * and let the sweep add the `/tmp` regime itself, which deleted the developer's
 * real `/tmp/padi-*-$UID` corpses and made `removed` depend on what the box was
 * carrying — on the very host class #2286 is about, the first run failed and the
 * second passed.
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
import { afterEach, expect, it } from "vitest";
import { daemonSweepRegimes, reapStaleDaemonHomes } from "./staleHomes.ts";

/** Above Linux's maximum `pid_max` (2^22) and macOS's (99998), so `kill(pid, 0)`
 *  can only ever answer "no such process" — a dead holder with nothing to fork
 *  and nothing to race. */
const DEAD_PID = 2_147_483_647;

const scratchDirs: string[] = [];

/** A drawer of this test's own, swept by path rather than by regime. */
function scratchRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "stale-homes-"));
  scratchDirs.push(dir);
  return dir;
}

/** One app home under `root`, 0700 like the real thing. */
function seedHome(root: string, name: string, gate?: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (gate !== undefined) writeFileSync(join(dir, "padi.pid"), gate);
  return dir;
}

afterEach(() => {
  for (const d of scratchDirs.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

it("removes a home whose gate names a dead holder, and keeps a live one", () => {
  const root = scratchRoot();
  const corpse = seedHome(root, "padi-deadbeef", String(DEAD_PID));
  const alive = seedHome(root, "padi-cafebabe", String(process.pid));

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  expect(sweep.removed).toEqual([corpse]);
  expect(existsSync(corpse)).toBe(false);
  expect(existsSync(alive)).toBe(true);
  expect(sweep.skipped).toContainEqual({ dir: alive, why: "live" });
});

it("keeps a GATELESS home — that is also what a daemon mid-boot looks like", () => {
  const root = scratchRoot();
  const booting = seedHome(root, "padi-0ddba11");

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  expect(sweep.removed).toEqual([]);
  expect(existsSync(booting)).toBe(true);
  expect(sweep.skipped).toContainEqual({ dir: booting, why: "no-gate" });
});

it("keeps a home that is not owner-only, however dead its gate looks", () => {
  const root = scratchRoot();
  const shared = seedHome(root, "padi-feedface", String(DEAD_PID));
  // Group/other bits — the same boundary the serving side refuses to bind under.
  chmodSync(shared, 0o755);

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  expect(sweep.removed).toEqual([]);
  expect(existsSync(shared)).toBe(true);
  expect(sweep.skipped).toContainEqual({ dir: shared, why: "not-ours" });
});

it("removes a MALFORMED gate's home (the pid-gate law's own verdict) and ignores foreign names", () => {
  const root = scratchRoot();
  const garbage = seedHome(root, "padi-badf00d", "not-a-pid\n");
  // Not a name this app mints — a sweep for `padi` must not reach another
  // daemon's home even with a dead gate beside it.
  const foreign = seedHome(root, "kaval-deadbeef", String(DEAD_PID));

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  expect(sweep.removed).toEqual([garbage]);
  expect(existsSync(foreign)).toBe(true);
});

it("reports a regime root it cannot list, instead of collecting nothing in silence", () => {
  const root = join(scratchRoot(), "never-created");

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  // A root that cannot be read is the one condition under which a sweep finds
  // no corpses for a reason that is not "there were none" — so it is a reported
  // skip, carrying the ROOT, rather than a bare `continue`.
  expect(sweep.removed).toEqual([]);
  expect(sweep.skipped.map((s) => [s.dir, s.why])).toEqual([
    [root, "root-unreadable"],
  ]);
});

it("sweeps a (root, grammar) pair once, however many regimes name it", () => {
  const root = scratchRoot();
  const corpse = seedHome(root, "padi-deadbeef", String(DEAD_PID));

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root, root],
  });

  // The de-dup is what keeps a process already running under `/tmp` from
  // walking it twice — and what would otherwise report the same removal twice.
  expect(sweep.removed).toEqual([corpse]);
});

it("keeps a home whose OWN gate is dead but whose co-tenant gate is live", () => {
  // juspay/kolu#2289 review B4. padi's home is shared: kolu-server's
  // "never two supervisors" claim sits beside padi's gate as `supervisor.pid`,
  // and pid-gate exclusion is `link(2)`/EEXIST on the FILE. A SIGKILLed padi
  // leaves a dead `padi.pid` while its supervisor is alive, and removing the
  // home recursively on padi's gate alone deletes a LIVE claim — after which a
  // second kolu-server claims successfully and the survivor is never told.
  const root = scratchRoot();
  const shared = seedHome(root, "padi-deadbeef", String(DEAD_PID));
  writeFileSync(join(shared, "supervisor.pid"), String(process.pid));

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  expect(sweep.removed).toEqual([]);
  expect(existsSync(join(shared, "supervisor.pid"))).toBe(true);
  expect(sweep.skipped).toContainEqual({ dir: shared, why: "live" });
});

it("removes the home once EVERY gate in it is dead", () => {
  const root = scratchRoot();
  const corpse = seedHome(root, "padi-cafebabe", String(DEAD_PID));
  writeFileSync(join(corpse, "supervisor.pid"), String(DEAD_PID));

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  expect(sweep.removed).toEqual([corpse]);
  expect(existsSync(corpse)).toBe(false);
});

it("keeps a home whose co-tenant gate cannot be read", () => {
  const root = scratchRoot();
  const shared = seedHome(root, "padi-feedbeef", String(DEAD_PID));
  const tenant = join(shared, "supervisor.pid");
  writeFileSync(tenant, String(DEAD_PID));
  chmodSync(tenant, 0o000);

  const sweep = reapStaleDaemonHomes({
    app: "padi",
    gateFile: "padi.pid",
    runtimeRoots: [root],
  });

  // EACCES is not an observation — the pid gate's own three-way law, applied to
  // the tenant as much as to the app's own gate.
  expect(sweep.removed).toEqual([]);
  expect(sweep.skipped).toContainEqual({ dir: shared, why: "gate-unreadable" });
  chmodSync(tenant, 0o600);
});

it("sweeps BOTH grammars when two regimes resolve to one root", () => {
  // M5. With `$XDG_RUNTIME_DIR` set to `/tmp` the two arms land on the SAME
  // root with DIFFERENT name shapes — the env arm mints `<app>-<hex>`, the
  // forced arm `<app>-<hex>-$UID`. De-duping by root alone dropped the second,
  // so on exactly such a host the `-$UID` corpses this sweep exists for were
  // never examined.
  //
  // `/tmp` is the real one here, by construction: the forced arm is rooted
  // there and no parameter can move it. What keeps that safe is the APP NAME —
  // a stem unique to this run, which no daemon on the box mints, so neither
  // grammar can match anything but the two homes seeded below.
  const uid = process.getuid?.();
  if (uid === undefined) return;
  const app = `sweepgrammar-${process.pid.toString(16)}`;
  const envShaped = join("/tmp", `${app}-deadbeef`);
  const tmpShaped = join("/tmp", `${app}-cafebabe-${uid}`);
  for (const dir of [envShaped, tmpShaped]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    scratchDirs.push(dir);
    writeFileSync(join(dir, `${app}.pid`), String(DEAD_PID), { mode: 0o600 });
  }

  const saved = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = "/tmp";
  try {
    const sweep = reapStaleDaemonHomes({
      app,
      gateFile: `${app}.pid`,
      runtimeRoots: [undefined, null],
    });
    expect([...sweep.removed].sort()).toEqual([envShaped, tmpShaped].sort());
  } finally {
    if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = saved;
  }
});

it("daemonSweepRegimes covers the /tmp arm under XDG, and only /tmp without it", () => {
  // M3. The `/tmp` arm is the whole point of the boot sweep — logind wipes the
  // XDG drawer at logout, so the regime that ACCUMULATES is the one a sweep
  // keyed on the env alone would never look at. Pinned here because the sweep
  // itself takes its roots as a parameter: nothing else fails if this policy
  // silently loses an arm.
  const saved = process.env.XDG_RUNTIME_DIR;
  try {
    process.env.XDG_RUNTIME_DIR = "/run/user/1000";
    expect(daemonSweepRegimes()).toEqual([undefined, null]);

    // Off XDG the env arm IS the `/tmp` arm, so one entry covers both and the
    // de-dup never has to.
    delete process.env.XDG_RUNTIME_DIR;
    expect(daemonSweepRegimes()).toEqual([null]);

    // An empty value is "unset" everywhere else in the regime algebra; it must
    // not read as an XDG drawer named "".
    process.env.XDG_RUNTIME_DIR = "";
    expect(daemonSweepRegimes()).toEqual([null]);
  } finally {
    if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = saved;
  }
});
