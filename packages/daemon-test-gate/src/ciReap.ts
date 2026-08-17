/**
 * End-of-run janitor for `just test-daemon` / CI (juspay/kolu#2178).
 *
 * Two jobs, both fail-safe toward production:
 *
 *  1. Remove **this run's** `padi-dial-rt-*` / `padi-dial-sr-*` /
 *     `kolu-scroll-fifo-*` runtime roots under `$TMPDIR`.
 *  2. Reap leftover **ci-owned** kaval/padi whose `KOLU_DAEMON_BIND_PID` is
 *     gone — TERM, then KILL. A process with no bind pid (production
 *     `forever`) or a live bind pid is left untouched. A command line that
 *     does not name a CI runtime root / odu checkout is left untouched.
 *
 * Odu checkout trees under `T/odu/kolu/` are another system's files; this
 * janitor does not delete them.
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

export const CI_RUNTIME_DIR_PREFIXES = [
  "padi-dial-rt-",
  "padi-dial-sr-",
  "kolu-scroll-fifo-",
] as const;

/** Command-line markers that name a CI / odu runtime, not a production daemon. */
const CI_ROOT_RE = /padi-dial-rt-|padi-dial-sr-|\/odu\/kolu\//;

/** The daemon binaries CI actually leaks — source `bin.ts` or the nix wrapper. */
const DAEMON_BIN_RE =
  /kaval\/src\/bin\.ts|padi\/src\/daemonBoot\/bin\.ts|\/bin\/kaval(?:\s|$)|\/bin\/padi(?:\s|$)/;

const SPAWN_HELPER_RE = /node-pty spawn-helper/;

export interface ListedProc {
  readonly pid: number;
  readonly user: string;
  readonly command: string;
}

export function isCiOwnedDaemonCommand(command: string): boolean {
  return CI_ROOT_RE.test(command) && DAEMON_BIN_RE.test(command);
}

export function isCiLeftoverHelperCommand(command: string): boolean {
  return SPAWN_HELPER_RE.test(command) && CI_ROOT_RE.test(command);
}

export function thisRunRuntimeRoot(): string {
  return process.env.KOLU_CI_REAP_ROOT ?? process.env.TMPDIR ?? tmpdir();
}

export function removeThisRunRuntimeRoots(
  root: string = thisRunRuntimeRoot(),
): string[] {
  const removed: string[] = [];
  let ents: ReturnType<typeof readdirSync>;
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch {
    return removed;
  }
  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    if (!CI_RUNTIME_DIR_PREFIXES.some((p) => ent.name.startsWith(p))) continue;
    const full = join(root, ent.name);
    rmSync(full, { recursive: true, force: true });
    removed.push(full);
  }
  return removed;
}

/** `ps` columns that carry the full command line: Darwin wants BSD `-A`/`command`,
 *  Linux procps refuses `-Ax` ("must set personality") and exposes the line as `args`. */
function psListArgs(): string[] {
  return process.platform === "darwin"
    ? ["-Axo", "user=,pid=,command="]
    : ["-eo", "user=,pid=,args="];
}

export function listProcesses(): ListedProc[] {
  const out = execFileSync("ps", psListArgs(), {
    encoding: "utf8",
  });
  const rows: ListedProc[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ user: m[1], pid: Number(m[2]), command: m[3] });
  }
  return rows;
}

export function readBindPidFromEnviron(pid: number): number | undefined {
  try {
    const env = readFileSync(`/proc/${pid}/environ`);
    const found = parseBindPidFromEnvironBytes(env);
    if (found !== undefined) return found;
  } catch {
    // No /proc (darwin) or the pid is already gone.
  }
  try {
    const out = execFileSync("ps", ["eww", "-p", String(pid)], {
      encoding: "utf8",
    });
    return parseBindPidFromPsEww(out);
  } catch {
    return undefined;
  }
}

export function parseBindPidFromEnvironBytes(buf: Buffer): number | undefined {
  for (const entry of buf.toString("utf8").split("\0")) {
    const parsed = bindPidValue(entry);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function parseBindPidFromPsEww(text: string): number | undefined {
  const m = text.match(/\bKOLU_DAEMON_BIND_PID=([1-9][0-9]*)/);
  return m ? Number(m[1]) : undefined;
}

function bindPidValue(entry: string): number | undefined {
  if (!entry.startsWith("KOLU_DAEMON_BIND_PID=")) return undefined;
  const raw = entry.slice("KOLU_DAEMON_BIND_PID=".length);
  if (!/^[1-9][0-9]*$/.test(raw)) return undefined;
  return Number(raw);
}

export function isPidLive(pid: number): boolean {
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
  if (!isPidLive(pid)) return "already-gone";
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return "already-gone";
  }
  if (await waitGone(pid, termMs, intervalMs)) return "SIGTERM";
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return "already-gone";
  }
  if (await waitGone(pid, killMs, intervalMs)) return "SIGKILL";
  return "survived";
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
    if (!isPidLive(pid)) return true;
    await sleep(Math.min(intervalMs, deadline - Date.now()));
  }
  return !isPidLive(pid);
}

export interface SweepDeps {
  list?: () => ListedProc[];
  readBindPid?: (pid: number) => number | undefined;
  live?: (pid: number) => boolean;
  reap?: (pid: number) => void | Promise<void>;
  /** Only consider this user's processes. Default: the running user. */
  onlyUser?: string;
}

export function selectBindPidGoneDaemons(
  procs: readonly ListedProc[],
  opts: {
    live: (pid: number) => boolean;
    readBindPid: (pid: number) => number | undefined;
    onlyUser: string;
  },
): number[] {
  const selected: number[] = [];
  for (const proc of procs) {
    if (proc.user !== opts.onlyUser) continue;
    if (proc.pid === process.pid) continue;
    if (isCiLeftoverHelperCommand(proc.command)) {
      selected.push(proc.pid);
      continue;
    }
    if (!isCiOwnedDaemonCommand(proc.command)) continue;
    const bind = opts.readBindPid(proc.pid);
    // No bind pid ⇒ production `forever`. Do not touch.
    if (bind === undefined) continue;
    if (opts.live(bind)) continue;
    selected.push(proc.pid);
  }
  return selected;
}

export async function sweepBindPidGoneDaemons(
  deps: SweepDeps = {},
): Promise<{ reaped: number[] }> {
  const onlyUser = deps.onlyUser ?? userInfo().username;
  const list = deps.list ?? listProcesses;
  const readBindPid = deps.readBindPid ?? readBindPidFromEnviron;
  const live = deps.live ?? isPidLive;
  const reap =
    deps.reap ??
    ((pid: number) =>
      reapUncooperative(pid, { termMs: 2_000, killMs: 5_000, intervalMs: 50 }));
  const targets = selectBindPidGoneDaemons(list(), {
    live,
    readBindPid,
    onlyUser,
  });
  const reaped: number[] = [];
  for (const pid of targets) {
    await reap(pid);
    reaped.push(pid);
  }
  return { reaped };
}

export async function reapCiRun(
  opts: { runtimeRoot?: string; sweep?: SweepDeps } = {},
): Promise<{ removedDirs: string[]; reaped: number[] }> {
  const removedDirs = removeThisRunRuntimeRoots(opts.runtimeRoot);
  const { reaped } = await sweepBindPidGoneDaemons(opts.sweep);
  return { removedDirs, reaped };
}
