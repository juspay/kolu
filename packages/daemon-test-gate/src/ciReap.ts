/**
 * End-of-run janitor for `just test-daemon` / CI (juspay/kolu#2178).
 *
 * Two jobs, both fail-safe toward production:
 *
 *  1. Remove leftover `padi-dial-rt-*` / `padi-dial-sr-*` /
 *     `kolu-scroll-fifo-*` runtime roots under the reap root. FIFO dirs
 *     kill their `cat` readers first — `rm` alone leaves `cat` on the
 *     unlinked inode (#2178).
 *  2. Reap leftover **ci-owned** kaval/padi / node-pty helpers whose
 *     command names a runtime-root prefix. A live bind pid is left
 *     untouched (a peer run). Production `forever` daemons never match
 *     those prefixes. Odu checkout trees under `T/odu/kolu/` are another
 *     system's files; this janitor does not delete them.
 */

import { execFileSync } from "node:child_process";
import { type Dirent, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
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
    /** Pids the sweep will reap — leftover daemons/helpers, not live peers. */
    doomed?: ReadonlySet<number>;
  } = {},
): string[] {
  const removed: string[] = [];
  let ents: Dirent[];
  try {
    ents = readdirSync(root, { withFileTypes: true });
  } catch {
    return removed;
  }
  const procs = (opts.list ?? listProcesses)();
  const doomed = opts.doomed ?? new Set<number>();
  for (const ent of ents) {
    if (!ent.isDirectory()) continue;
    if (!CI_RUNTIME_DIR_PREFIXES.some((p) => ent.name.startsWith(p))) continue;
    const full = join(root, ent.name);
    const namedByPeer = procs.some(
      (p) =>
        p.command.includes(full) &&
        !doomed.has(p.pid) &&
        !(
          ent.name.startsWith(SCROLL_FIFO_DIR_PREFIX) &&
          /\bcat\b/.test(p.command)
        ),
    );
    if (namedByPeer) continue;
    if (ent.name.startsWith(SCROLL_FIFO_DIR_PREFIX)) {
      killScrollFifoReaders(join(full, "trigger"));
    }
    rmSync(full, { recursive: true, force: true });
    removed.push(full);
  }
  return removed;
}

/** SIGKILL every `cat` whose command line names this FIFO path. */
export function killScrollFifoReaders(fifoPath: string): number[] {
  const killed: number[] = [];
  for (const proc of listProcesses()) {
    if (!proc.command.includes(fifoPath) || !/\bcat\b/.test(proc.command))
      continue;
    if (proc.pid === process.pid) continue;
    try {
      process.kill(proc.pid, "SIGKILL");
      killed.push(proc.pid);
    } catch {
      // Already gone.
    }
  }
  return killed;
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
    const [, user, pidRaw, command] = m;
    if (user === undefined || pidRaw === undefined || command === undefined)
      continue;
    rows.push({ user, pid: Number(pidRaw), command });
  }
  return rows;
}

export type BindPidRead =
  | { kind: "bound"; pid: number }
  | { kind: "absent" }
  | { kind: "unreadable" };

export function readBindPidFromEnviron(pid: number): BindPidRead {
  try {
    const env = readFileSync(`/proc/${pid}/environ`);
    const found = parseBindPidFromEnvironBytes(env);
    if (found !== undefined) return { kind: "bound", pid: found };
    return { kind: "absent" };
  } catch {
    // No /proc (darwin) or the pid is already gone — fall through to ps.
  }
  try {
    const out = execFileSync("ps", ["eww", "-p", String(pid)], {
      encoding: "utf8",
    });
    const found = parseBindPidFromPsEww(out);
    if (found !== undefined) return { kind: "bound", pid: found };
    return { kind: "absent" };
  } catch {
    return { kind: "unreadable" };
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
  /** Only consider this user's processes. Default: the running user. */
  onlyUser?: string;
}

export function selectBindPidGoneDaemons(
  procs: readonly ListedProc[],
  opts: {
    live: (pid: number) => boolean;
    readBindPid: (pid: number) => BindPidRead;
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
    // Unreadable: cannot tell a peer run from a leftover. Do not reap.
    if (bind.kind === "unreadable") continue;
    // Absent bind on a CI-owned command is a leftover, not production
    // (production never matches a runtime-root prefix). Bound + live is a peer run.
    if (bind.kind === "bound" && opts.live(bind.pid)) continue;
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
  const live = deps.live ?? isReachablePid;
  const reap =
    deps.reap ??
    ((pid: number) =>
      reapUncooperative(pid, { termMs: 2_000, killMs: 5_000, intervalMs: 50 }));
  const select = (): number[] =>
    selectBindPidGoneDaemons(list(), { live, readBindPid, onlyUser });
  const targets = select();
  const reaped: number[] = [];
  for (const pid of targets) {
    // Re-identify immediately before the signal — a pid is not an identity
    // after exit (pidGate.ts). A reuse during the TERM/KILL window must
    // not inherit the earlier verdict.
    if (!select().includes(pid)) continue;
    const ended = await reap(pid);
    if (ended === "survived") continue;
    reaped.push(pid);
  }
  return { reaped };
}

export async function reapCiRun(
  opts: { runtimeRoot?: string; sweep?: SweepDeps } = {},
): Promise<{ removedDirs: string[]; reaped: number[] }> {
  const { reaped } = await sweepBindPidGoneDaemons(opts.sweep);
  const removedDirs = removeThisRunRuntimeRoots(opts.runtimeRoot, {
    list: opts.sweep?.list,
  });
  return { removedDirs, reaped };
}
