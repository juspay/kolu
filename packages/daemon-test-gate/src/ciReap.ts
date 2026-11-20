import { execFileSync } from "node:child_process";
import { type Dirent, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PADI_DIAL_RT_PREFIX = "padi-dial-rt-";
export const PADI_DIAL_SR_PREFIX = "padi-dial-sr-";
export const SCROLL_FIFO_DIR_PREFIX = "kolu-scroll-fifo-";

export const CI_RUNTIME_DIR_PREFIXES = [
  PADI_DIAL_RT_PREFIX,
  PADI_DIAL_SR_PREFIX,
  SCROLL_FIFO_DIR_PREFIX,
] as const;

function commandNamesRuntimeRoot(command: string): boolean {
  return CI_RUNTIME_DIR_PREFIXES.some((p) => command.includes(p));
}

const DAEMON_BIN_RE =
  /kaval\/src\/bin\.ts|padi\/src\/daemonBoot\/bin\.ts|\/bin\/kaval(?:\s|$)|\/bin\/padi(?:\s|$)/;

const SPAWN_HELPER_RE = /node-pty spawn-helper/;

export interface ListedProc {
  readonly pid: number;
  readonly uid: number;
  readonly command: string;
}

export function isCiOwnedDaemonCommand(command: string): boolean {
  return commandNamesRuntimeRoot(command) && DAEMON_BIN_RE.test(command);
}

export function isCiLeftoverHelperCommand(command: string): boolean {
  return SPAWN_HELPER_RE.test(command) && commandNamesRuntimeRoot(command);
}

export function thisRunRuntimeRoot(): string {
  return process.env.KOLU_CI_REAP_ROOT ?? process.env.TMPDIR ?? tmpdir();
}

export function removeThisRunRuntimeRoots(
  root: string = thisRunRuntimeRoot(),
  opts: {
    list?: () => ListedProc[];
  } = {},
): string[] {
  const removed: string[] = [];
  let ents: Dirent[];
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return removed;
    throw err;
  }
  const list = opts.list ?? listProcesses;
  const procs = list();
  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    if (!CI_RUNTIME_DIR_PREFIXES.some((p) => ent.name.startsWith(p))) continue;
    const full = join(root, ent.name);
    if (ent.name.startsWith(SCROLL_FIFO_DIR_PREFIX)) {
      const owner = readOwnerPid(join(full, "owner"));
      if (owner !== undefined && isReachablePid(owner)) continue;
      killScrollFifoReaders(join(full, "trigger"), list);
    } else if (procs.some((p) => p.command.includes(full))) {
      continue;
    }
    rmSync(full, { recursive: true, force: true });
    removed.push(full);
  }
  return removed;
}

function readOwnerPid(path: string): number | undefined {
  try {
    const raw = readFileSync(path, "utf8").trim();
    if (!/^[1-9][0-9]*$/.test(raw)) return undefined;
    return Number(raw);
  } catch {
    return undefined;
  }
}

function commandArgv0IsCat(command: string): boolean {
  const argv0 = command.trim().split(/\s+/)[0] ?? "";
  const base = argv0.slice(
    Math.max(argv0.lastIndexOf("/"), argv0.lastIndexOf("\\")) + 1,
  );
  return base === "cat";
}

/** SIGKILL every `cat` whose command line names this FIFO path. */
export function killScrollFifoReaders(
  fifoPath: string,
  list: () => ListedProc[] = listProcesses,
): number[] {
  const killed: number[] = [];
  for (const proc of list()) {
    if (!proc.command.includes(fifoPath) || !commandArgv0IsCat(proc.command))
      continue;
    if (proc.pid === process.pid) continue;
    try {
      process.kill(proc.pid, "SIGKILL");
      killed.push(proc.pid);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
    }
  }
  return killed;
}

/** `ps` columns that carry the full command line. Darwin needs repeated `w`
 *  or the command is truncated to the window (80 with no tty). Linux procps
 *  refuses `-Ax` and exposes the line as `args`. Select by uid, not `user=`
 *  — `user=` truncates to 8 chars and prints `+`. */
export function processListArgs(): string[] {
  return process.platform === "darwin"
    ? ["-Axww", "-o", "uid=,pid=,command="]
    : ["-eo", "uid=,pid=,args="];
}

/** `maxBuffer` is unbounded on purpose: a process listing has no natural size
 *  — one busy CI box (680 processes, compiler lines of 14 KB each) printed
 *  2.2 MiB — and Node's 1 MiB default turns that into ENOBUFS, which fails the
 *  reap on exactly the loaded host it exists for. */
export function listProcesses(): ListedProc[] {
  const out = execFileSync("ps", processListArgs(), {
    encoding: "utf8",
    maxBuffer: Number.POSITIVE_INFINITY,
  });
  const rows: ListedProc[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const [, uidRaw, pidRaw, command] = m;
    if (uidRaw === undefined || pidRaw === undefined || command === undefined)
      continue;
    rows.push({ uid: Number(uidRaw), pid: Number(pidRaw), command });
  }
  return rows;
}

export type BindPidRead =
  | { kind: "bound"; pid: number }
  | { kind: "absent" }
  | { kind: "unreadable" };

const PROC_ENVIRON_UNREADABLE: Record<string, true> = {
  ENOENT: true,
  ENOTDIR: true,
  EACCES: true,
  EPERM: true,
  ESRCH: true,
};

function readBindPidFromProcEnviron(pid: number): BindPidRead | null {
  try {
    return parseBindPidFromEnvironBytes(readFileSync(`/proc/${pid}/environ`));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== undefined && PROC_ENVIRON_UNREADABLE[code] === true)
      return null;
    throw err;
  }
}

export function readBindPidFromEnviron(pid: number): BindPidRead {
  const fromProcEnviron = readBindPidFromProcEnviron(pid);
  if (fromProcEnviron !== null) return fromProcEnviron;
  try {
    const out = execFileSync("ps", ["eww", "-p", String(pid)], {
      encoding: "utf8",
      maxBuffer: Number.POSITIVE_INFINITY,
    });
    const found = parseBindPidFromPsEww(out);
    if (found !== undefined) return { kind: "bound", pid: found };
    return { kind: "absent" };
  } catch {
    return { kind: "unreadable" };
  }
}

export function parseBindPidFromEnvironBytes(buf: Buffer): BindPidRead {
  for (const entry of buf.toString("utf8").split("\0")) {
    if (!entry.startsWith("KOLU_DAEMON_BIND_PID=")) continue;
    const raw = entry.slice("KOLU_DAEMON_BIND_PID=".length);
    if (!/^[1-9][0-9]*$/.test(raw)) return { kind: "unreadable" };
    return { kind: "bound", pid: Number(raw) };
  }
  return { kind: "absent" };
}

export function parseBindPidFromPsEww(text: string): number | undefined {
  const m = text.match(/\bKOLU_DAEMON_BIND_PID=([1-9][0-9]*)/);
  return m ? Number(m[1]) : undefined;
}

/** `kill(0)` plus EPERM-is-alive — the same rule as `isHolderLive`.
 *  Named apart from hooks.ts `isPidLive`, which treats every throw as dead. */
export function isReachablePid(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function reapUncooperative(
  pid: number,
  opts: { termMs?: number; killMs?: number; intervalMs?: number } = {},
): Promise<"already-gone" | "SIGTERM" | "SIGKILL" | "survived"> {
  const termMs = opts.termMs ?? 2_000;
  const killMs = opts.killMs ?? 5_000;
  const intervalMs = opts.intervalMs ?? 50;
  if (!isReachablePid(pid)) return "already-gone";
  try {
    process.kill(pid, "SIGTERM");
  } catch (err) {
    return killMiss(err);
  }
  if (await waitGone(pid, termMs, intervalMs)) return "SIGTERM";
  try {
    process.kill(pid, "SIGKILL");
  } catch (err) {
    return killMiss(err);
  }
  if (await waitGone(pid, killMs, intervalMs)) return "SIGKILL";
  return "survived";
}

function killMiss(err: unknown): "already-gone" | "survived" {
  return (err as NodeJS.ErrnoException).code === "ESRCH"
    ? "already-gone"
    : "survived";
}

export function thisUid(): number {
  const fn = process.getuid;
  if (fn === undefined) {
    throw new Error("ciReap: process.getuid is required (not Windows)");
  }
  return fn();
}

export function thisRunBindPid(): number | undefined {
  const raw = process.env.KOLU_CI_REAP_BIND_PID;
  if (raw === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(
      `KOLU_CI_REAP_BIND_PID=${JSON.stringify(raw)} is not a single process`,
    );
  }
  return Number(raw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitGone(
  pid: number,
  timeoutMs: number,
  intervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isReachablePid(pid)) return true;
    await sleep(Math.min(intervalMs, deadline - Date.now()));
  }
  return !isReachablePid(pid);
}

export interface SweepDeps {
  list?: () => ListedProc[];
  readBindPid?: (pid: number) => BindPidRead;
  live?: (pid: number) => boolean;
  reap?: (pid: number) => unknown;
  /** Only consider this uid. Default: the running process's uid. */
  onlyUid?: number;
  /** Bind pid of THIS recipe — still live in the EXIT trap. Treat as gone. */
  thisRunBind?: number;
}

function isReapableCiLeftover(
  proc: ListedProc,
  opts: {
    live: (pid: number) => boolean;
    readBindPid: (pid: number) => BindPidRead;
    onlyUid: number;
    thisRunBind?: number;
  },
): boolean {
  if (proc.uid !== opts.onlyUid) return false;
  if (proc.pid === process.pid) return false;
  const helper = isCiLeftoverHelperCommand(proc.command);
  if (!helper && !isCiOwnedDaemonCommand(proc.command)) return false;
  const bind = opts.readBindPid(proc.pid);
  switch (bind.kind) {
    case "unreadable":
      return false;
    case "bound":
      return bind.pid === opts.thisRunBind || !opts.live(bind.pid);
    case "absent":
      return !helper;
    default:
      bind satisfies never;
      return false;
  }
}

export function selectBindPidGoneDaemons(
  procs: readonly ListedProc[],
  opts: {
    live: (pid: number) => boolean;
    readBindPid: (pid: number) => BindPidRead;
    onlyUid: number;
    thisRunBind?: number;
  },
): number[] {
  return procs
    .filter((proc) => isReapableCiLeftover(proc, opts))
    .map((proc) => proc.pid);
}

export async function sweepBindPidGoneDaemons(
  deps: SweepDeps = {},
): Promise<{ reaped: number[]; survived: number[] }> {
  const onlyUid = deps.onlyUid ?? thisUid();
  const list = deps.list ?? listProcesses;
  const readBindPid = deps.readBindPid ?? readBindPidFromEnviron;
  const live = deps.live ?? isReachablePid;
  const thisRunBind = deps.thisRunBind ?? thisRunBindPid();
  const reap =
    deps.reap ??
    ((pid: number) =>
      reapUncooperative(pid, { termMs: 2_000, killMs: 5_000, intervalMs: 50 }));
  const reapableNow = (): number[] =>
    selectBindPidGoneDaemons(list(), {
      live,
      readBindPid,
      onlyUid,
      thisRunBind,
    });
  const targets = reapableNow();
  const reaped: number[] = [];
  const survived: number[] = [];
  for (const pid of targets) {
    if (!reapableNow().includes(pid)) continue;
    const ended = await reap(pid);
    if (ended === "survived") {
      survived.push(pid);
      continue;
    }
    reaped.push(pid);
  }
  return { reaped, survived };
}

export async function reapCiRun(
  opts: { runtimeRoot?: string; sweep?: SweepDeps } = {},
): Promise<{ removedDirs: string[]; reaped: number[]; survived: number[] }> {
  const { reaped, survived } = await sweepBindPidGoneDaemons(opts.sweep);
  const removedDirs = removeThisRunRuntimeRoots(opts.runtimeRoot, {
    list: opts.sweep?.list,
  });
  return { removedDirs, reaped, survived };
}
