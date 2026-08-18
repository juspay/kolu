/**
 * The shipped CI janitor — runtime-root removal and the bind-pid-gone sweep —
 * driven against real fixtures, not a copy of the unit under test.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  isCiLeftoverHelperCommand,
  isCiOwnedDaemonCommand,
  isReachablePid,
  listProcesses,
  parseBindPidFromEnvironBytes,
  parseBindPidFromPsEww,
  processListArgs,
  thisUid,
  reapCiRun,
  reapUncooperative,
  removeThisRunRuntimeRoots,
  selectBindPidGoneDaemons,
  sweepBindPidGoneDaemons,
  thisRunRuntimeRoot,
} from "./ciReap.ts";

const children: number[] = [];
const tmpDirs: string[] = [];
afterEach(() => {
  for (const pid of children.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "ci-reap-"));
  tmpDirs.push(dir);
  return dir;
}

async function deadPid(): Promise<number> {
  const child = spawn("bash", ["-c", "exit 0"], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("sentinel did not start");
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!isReachablePid(pid)) return pid;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("sentinel did not die");
}

async function trapTermSleeper(): Promise<number> {
  const child = spawn("bash", ["-c", 'trap "" TERM; echo up; exec sleep 600'], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pid = child.pid;
  if (pid === undefined) throw new Error("sleeper did not start");
  children.push(pid);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("error", reject);
  });
  return pid;
}

it("thisRunRuntimeRoot prefers KOLU_CI_REAP_ROOT over TMPDIR", () => {
  const prevRoot = process.env.KOLU_CI_REAP_ROOT;
  const prevTmp = process.env.TMPDIR;
  process.env.TMPDIR = "/tmp/would-be-wrong";
  process.env.KOLU_CI_REAP_ROOT = "/tmp/pinned-ci-root";
  try {
    expect(thisRunRuntimeRoot()).toBe("/tmp/pinned-ci-root");
  } finally {
    if (prevRoot === undefined) delete process.env.KOLU_CI_REAP_ROOT;
    else process.env.KOLU_CI_REAP_ROOT = prevRoot;
    if (prevTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prevTmp;
  }
});

it("removeThisRunRuntimeRoots deletes only this-run prefixes, leaves the rest", () => {
  const root = scratch();
  const rt = join(root, "padi-dial-rt-aaa");
  const sr = join(root, "padi-dial-sr-bbb");
  const fifo = join(root, "kolu-scroll-fifo-ccc");
  const keep = join(root, "unrelated-keep");
  for (const d of [rt, sr, fifo, keep]) mkdirSync(d);
  writeFileSync(join(keep, "x"), "stay");
  const removed = removeThisRunRuntimeRoots(root);
  expect(removed.sort()).toEqual([fifo, rt, sr].sort());
  expect(existsSync(rt)).toBe(false);
  expect(existsSync(sr)).toBe(false);
  expect(existsSync(fifo)).toBe(false);
  expect(existsSync(keep)).toBe(true);
});

it("processListArgs selects by uid and widens darwin command", () => {
  const args = processListArgs();
  expect(args.join(" ")).toMatch(/uid=/);
  expect(args.join(" ")).not.toMatch(/user=/);
  if (process.platform === "darwin") {
    expect(args.some((a) => /w{2}/.test(a) || a.includes("ww"))).toBe(true);
  }
});

it("isCiOwnedDaemonCommand requires a CI root AND a daemon bin", () => {
  expect(
    isCiOwnedDaemonCommand(
      "node packages/kaval/src/bin.ts --socket /tmp/nix-shell.x/padi-dial-rt-KcY/kaval/pty-host.sock",
    ),
  ).toBe(true);
  expect(
    isCiOwnedDaemonCommand(
      "node /odu/kolu/2149dc9/packages/kaval/src/bin.ts --socket /tmp/padi-dial-rt-x/kaval/pty-host.sock",
    ),
  ).toBe(true);
  // An odu checkout in cwd is not a kill warrant by itself.
  expect(
    isCiOwnedDaemonCommand(
      "node /odu/kolu/2149dc9/packages/kaval/src/bin.ts --socket /tmp/kaval/pty-host.sock",
    ),
  ).toBe(false);
  expect(
    isCiOwnedDaemonCommand(
      "node packages/padi/src/daemonBoot/bin.ts --state-root /tmp/padi-dial-sr-nMu",
    ),
  ).toBe(true);
  // Production kaval — no CI root.
  expect(
    isCiOwnedDaemonCommand(
      "node /nix/store/abc/bin/kaval --socket /run/kaval/pty-host.sock",
    ),
  ).toBe(false);
  // A CI root without a daemon bin.
  expect(isCiOwnedDaemonCommand("cat /tmp/padi-dial-rt-x/trigger")).toBe(false);
});

it("isCiLeftoverHelperCommand matches node-pty helpers on a CI root", () => {
  expect(
    isCiLeftoverHelperCommand(
      "node-pty spawn-helper /tmp/nix-shell.0B/padi-dial-sr-nMu /bin/zsh",
    ),
  ).toBe(true);
  expect(
    isCiLeftoverHelperCommand("node-pty spawn-helper /home/srid /bin/zsh"),
  ).toBe(false);
  expect(
    isCiLeftoverHelperCommand(
      "node-pty spawn-helper /home/ci/T/odu/kolu/abc /bin/zsh",
    ),
  ).toBe(false);
});

it("selectBindPidGoneDaemons skips production (no bind pid) and live-bind daemons", () => {
  const me = thisUid();
  const procs = [
    {
      pid: 10,
      uid: me,
      command:
        "node packages/kaval/src/bin.ts --socket /tmp/padi-dial-rt-x/kaval.sock",
    },
    {
      pid: 11,
      uid: me,
      command:
        "node packages/kaval/src/bin.ts --socket /tmp/padi-dial-rt-y/kaval.sock",
    },
    {
      pid: 12,
      uid: me + 1,
      command:
        "node packages/kaval/src/bin.ts --socket /tmp/padi-dial-rt-z/kaval.sock",
    },
    {
      pid: 13,
      uid: me,
      command:
        "node /nix/store/abc/bin/kaval --socket /run/kaval/pty-host.sock",
    },
  ];
  const bindOf: Record<
    number,
    { kind: "bound"; pid: number } | { kind: "absent" } | { kind: "unreadable" }
  > = {
    10: { kind: "bound", pid: 99 }, // dead bind
    11: { kind: "bound", pid: 100 }, // live bind
    12: { kind: "bound", pid: 99 },
    13: { kind: "bound", pid: 99 },
  };
  const selected = selectBindPidGoneDaemons(procs, {
    live: (pid) => pid === 100,
    readBindPid: (pid) => bindOf[pid] ?? { kind: "absent" },
    onlyUid: me,
  });
  expect(selected).toEqual([10]);
});

it("selectBindPidGoneDaemons reaps CI-owned with absent bind, skips unreadable", () => {
  const me = thisUid();
  const procs = [
    {
      pid: 20,
      uid: me,
      command:
        "node packages/kaval/src/bin.ts --socket /tmp/padi-dial-rt-x/kaval.sock",
    },
    {
      pid: 21,
      uid: me,
      command:
        "node packages/kaval/src/bin.ts --socket /tmp/padi-dial-rt-y/kaval.sock",
    },
  ];
  const selected = selectBindPidGoneDaemons(procs, {
    live: () => false,
    readBindPid: (pid) =>
      pid === 20 ? { kind: "absent" } : { kind: "unreadable" },
    onlyUid: me,
  });
  expect(selected).toEqual([20]);
});

it("selectBindPidGoneDaemons treats this-run bind as gone and skips helpers with no bind", () => {
  const me = thisUid();
  const procs = [
    {
      pid: 30,
      uid: me,
      command:
        "node packages/kaval/src/bin.ts --socket /tmp/padi-dial-rt-x/kaval.sock",
    },
    {
      pid: 31,
      uid: me,
      command: "node-pty spawn-helper /tmp/padi-dial-sr-live /bin/zsh",
    },
    {
      pid: 32,
      uid: me,
      command: "node-pty spawn-helper /tmp/padi-dial-sr-dead /bin/zsh",
    },
  ];
  const selected = selectBindPidGoneDaemons(procs, {
    live: (pid) => pid !== 88,
    readBindPid: (pid) =>
      pid === 31
        ? { kind: "absent" }
        : { kind: "bound", pid: pid === 30 ? 99 : 88 },
    onlyUid: me,
    thisRunBind: 99,
  });
  expect(selected).toEqual([30, 32]);
});

it("parseBindPid reads the canonical env spelling from /proc bytes and ps eww", () => {
  expect(
    parseBindPidFromEnvironBytes(
      Buffer.from("PATH=/bin\0KOLU_DAEMON_BIND_PID=4321\0HOME=/tmp\0"),
    ),
  ).toBe(4321);
  expect(
    parseBindPidFromEnvironBytes(Buffer.from("PATH=/bin\0HOME=/tmp\0")),
  ).toBeUndefined();
  expect(
    parseBindPidFromPsEww(
      "PID TTY STAT TIME COMMAND\n123 ?? S 0:00 node bin.ts KOLU_DAEMON_BIND_PID=77 FOO=1",
    ),
  ).toBe(77);
});

it("reapUncooperative escalates to SIGKILL when the child ignores SIGTERM", async () => {
  const pid = await trapTermSleeper();
  expect(isReachablePid(pid)).toBe(true);
  const ended = await reapUncooperative(pid, {
    termMs: 300,
    killMs: 2_000,
    intervalMs: 20,
  });
  expect(ended).toBe("SIGKILL");
  expect(isReachablePid(pid)).toBe(false);
});

it("sweepBindPidGoneDaemons reaps a real SIGTERM-deaf child whose bind pid is already dead", async () => {
  const bind = await deadPid();
  // bash -c execs a trailing `sleep`, so the CI-root markers have to live in
  // argv ($0/$1) and the process has to stay bash (a builtin `read` loop).
  const child = spawn(
    "bash",
    [
      "-c",
      'trap "" TERM; echo up; while :; do read -r -t 60 || true; done',
      "packages/kaval/src/bin.ts",
      "--socket=/tmp/padi-dial-rt-fixture/pty-host.sock",
    ],
    {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, KOLU_DAEMON_BIND_PID: String(bind) },
    },
  );
  const pid = child.pid;
  if (pid === undefined) throw new Error("orphan fixture did not start");
  children.push(pid);
  await new Promise<void>((resolve, reject) => {
    child.stdout.once("data", () => resolve());
    child.once("error", reject);
  });
  expect(isReachablePid(pid)).toBe(true);

  const { reaped } = await sweepBindPidGoneDaemons({
    list: () => listProcesses().filter((p) => p.pid === pid),
    reap: (p) =>
      reapUncooperative(p, { termMs: 300, killMs: 2_000, intervalMs: 20 }),
  });
  expect(reaped).toContain(pid);
  expect(isReachablePid(pid)).toBe(false);
});

it("removeThisRunRuntimeRoots skips a dir a live peer still names", () => {
  const root = scratch();
  const peerDir = join(root, "padi-dial-rt-live-peer");
  mkdirSync(peerDir);
  const leftover = join(root, "padi-dial-rt-orphan");
  mkdirSync(leftover);
  const me = thisUid();
  const removed = removeThisRunRuntimeRoots(root, {
    list: () => [
      {
        pid: 4242,
        uid: me,
        command: `node packages/kaval/src/bin.ts --socket ${peerDir}/pty-host.sock`,
      },
    ],
  });
  expect(removed).toEqual([leftover]);
  expect(existsSync(peerDir)).toBe(true);
  expect(existsSync(leftover)).toBe(false);
});

it("removeThisRunRuntimeRoots kills leftover fifo cats before rm", async () => {
  const root = scratch();
  const dir = join(root, "kolu-scroll-fifo-orphan");
  mkdirSync(dir);
  const fifo = join(dir, "trigger");
  execFileSync("mkfifo", [fifo]);
  const cat = spawn("cat", [fifo], { stdio: "ignore" });
  const pid = cat.pid;
  if (pid === undefined) throw new Error("cat did not start");
  children.push(pid);
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && !isReachablePid(pid)) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(isReachablePid(pid)).toBe(true);
  const removed = removeThisRunRuntimeRoots(root);
  expect(removed).toEqual([dir]);
  expect(existsSync(dir)).toBe(false);
  const goneBy = Date.now() + 2_000;
  while (Date.now() < goneBy && isReachablePid(pid)) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(isReachablePid(pid)).toBe(false);
});

it("reapCiRun drives dir removal and the sweep together on a fixture", async () => {
  const root = scratch();
  const leftover = join(root, "padi-dial-rt-dead");
  mkdirSync(leftover);
  const { removedDirs, reaped } = await reapCiRun({
    runtimeRoot: root,
    sweep: {
      list: () => [],
      reap: () => {
        throw new Error("sweep must not reap an empty list");
      },
    },
  });
  expect(removedDirs).toEqual([leftover]);
  expect(existsSync(leftover)).toBe(false);
  expect(reaped).toEqual([]);
});
