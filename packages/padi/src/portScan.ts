/**
 * padi's port sensor — ONE host-wide pass that answers "what is each terminal
 * serving?" by joining the host's listening TCP sockets to each terminal's shell
 * subtree.
 *
 * It lives in padi, beside the git sensor and `memorySampler`, because the repo's
 * own taxonomy draws the line there: a fact that needs the PTY itself lives in
 * kaval (foreground needs `tcgetpgrp` on the PTY fd), a fact derived by OS
 * inspection from a snapshot key lives in padi. This scan's only input is each
 * shell's ROOT PID — which padi already holds — so it needs no PTY access and
 * changes no kaval wire contract.
 *
 * ## The discipline (all three are load-bearing, not style)
 *
 *  - **No OS state between ticks.** Parse, join, emit the structural `PortInfo`
 *    set, drop everything else. No retained fds, no process objects, no cached
 *    pid table. A scanner that keeps fds open to "go faster" is how a port
 *    watcher becomes the thing holding a dead server's socket alive.
 *  - **Repartition from the CURRENT root pids every tick.** The subtree map is
 *    rebuilt from the caller's live target list on every pass, so a terminal
 *    opening, closing, or being re-keyed can never leave a stale subtree behind.
 *  - **Attribution is the live ppid subtree, and nothing more.** Backgrounded
 *    (`&`) jobs, pipelines and grandchildren all keep the shell as an ancestor,
 *    so the walk sees them. A TRUE daemon (setsid / double-fork, reparented to
 *    init) has LEFT the subtree and is deliberately invisible here — no
 *    session-id heuristics, no host-wide orphan matching. If you daemonized it,
 *    it is no longer "this terminal's server".
 *
 * ## Errors: a blind scan must never look like an empty one
 *
 * Per-pid `ENOENT` is EXPECTED — a scan races process exit constantly. So is an
 * unreadable pid that is **not ours**, and that includes pids INSIDE a subtree:
 * a setuid-root child (`sudo` at its password prompt, `su`, `pkexec`) is a
 * routine descendant of an ordinary shell, and its `/proc/<pid>/fd` is `EACCES`
 * to us. Both are skipped.
 *
 * The one fatal case is an unreadable **requested ROOT** pid — a shell padi
 * spawned itself, so padi's own uid. Unreadable there means we genuinely cannot
 * answer for that terminal, and answering "no ports" would be a lie shaped
 * exactly like the truth. That throws (`caught-error-must-not-collapse-to-empty`).
 *
 * Getting that distinction wrong is not a small mistake, and this file had it
 * wrong: every in-subtree `EACCES` threw, so one `sudo` in one terminal emptied
 * the Ports section for **every** terminal on the host — and kept it empty, with
 * an ERROR every 5 s, until the prompt was answered. See {@link fdListFailure}.
 *
 * ## Why these two mechanisms
 *
 * On linux, `/proc` is read directly: `ss` measured ~7× slower AND hides other
 * users' pid attribution.
 *
 * On darwin the mechanism is **`lsof`**, and this REVERSES the plan's original
 * choice of `netstat`. The plan measured netstat as ~11× faster and "more
 * complete", and both claims were true of the box it was measured on — but on
 * **macOS 27.0** `netstat -anv` returns an EMPTY internet table to this process
 * while reporting success: zero bytes, exit 0, nothing on stderr. Not a parse
 * failure, not an argument problem (the same binary, absolute path, through a
 * shell, all empty; `netstat -anv -f inet` returns 117 bytes of nothing) — the
 * table simply is not visible to us there, and it IS visible to lsof in the very
 * same process. A mechanism that silently answers "no ports" is the worst
 * possible one for this feature, so it is gone rather than kept as a fallback.
 *
 * The "less complete" half of the old comparison costs us nothing: non-root lsof
 * reports only the invoking user's processes, and a terminal's subtree is padi's
 * OWN user by construction — every port we could ever attribute is one lsof shows.
 *
 * Measured end-to-end through this module: linux ~3 ms; macOS 26.4 lsof 17 ms,
 * macOS 27.0 lsof 93 ms (a busier box).
 *
 * ## Both platforms are verified against a live OS, not just fixtures
 *
 * `portScan.live.test.ts` spawns real listeners and asks this module about them,
 * on whatever platform it runs. That suite exists because fixtures pin the
 * PARSERS but cannot pin the assumption that the parser is handed the shape it
 * expects — and that gap produced a real bug: this file first looked for a
 * `netstat` header column called `pid`, and macOS 26.4 calls it **`process:pid`**
 * (value `node:53082`), so every darwin scan threw while every fixture test
 * stayed green. Found by running it on a Mac, not by reading it.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { PortInfo, TerminalId } from "@kolu/terminal-vocab/schema";

const execFileAsync = promisify(execFile);

/** One terminal to attribute ports to — its id and the ROOT pid of its PTY (the
 *  shell for a shell-rooted terminal, the command for a command-rooted one). The
 *  caller re-reads these every tick; the scan holds none of it. */
export interface PortScanTarget {
  id: TerminalId;
  rootPid: number;
}

/** How long a darwin `ps` / `lsof` may run before it is killed. macOS ships no
 *  GNU `timeout`, so the timer is Node's (`execFile`'s own `timeout`, which sends
 *  the kill signal) — a hung helper must not wedge the sampler's single-flight
 *  slot forever. Generous against the measured 17-93 ms so a loaded box is not
 *  mistaken for a hang. */
export const PORT_SCAN_COMMAND_TIMEOUT_MS = 5_000;

/** A scan that could not SEE what it was asked about — distinct from a scan that
 *  looked and found nothing. Thrown so the caller reports blindness instead of
 *  publishing an empty port list that reads identically to "this terminal serves
 *  nothing". */
export class PortScanError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PortScanError";
  }
}

/** The node error shape both platforms' fs failures arrive in. */
function errnoOf(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

// ── The pid table + subtree partition (platform-independent) ───────────

/** One row of the host's process table — the whole shape either platform's
 *  reader produces, and everything the join needs. */
export interface ProcessRow {
  pid: number;
  ppid: number;
  /** The process's own name, already reduced to a basename. */
  name: string;
}

/** Partition the host's process table into one pid SET per requested terminal.
 *
 *  Pure, so the walk is testable without a `/proc`. A pid can land in only one
 *  subtree (a process has one parent chain), and a root pid absent from the table
 *  yields an empty set — its terminal is exiting, which reads as "no ports" and
 *  is honest: the process really is gone. */
export function partitionSubtrees(
  table: readonly ProcessRow[],
  targets: readonly PortScanTarget[],
): Map<TerminalId, Set<number>> {
  const children = new Map<number, number[]>();
  for (const row of table) {
    const siblings = children.get(row.ppid);
    if (siblings === undefined) children.set(row.ppid, [row.pid]);
    else siblings.push(row.pid);
  }
  const alive = new Set(table.map((row) => row.pid));
  const subtrees = new Map<TerminalId, Set<number>>();
  for (const target of targets) {
    const pids = new Set<number>();
    if (alive.has(target.rootPid)) {
      // Iterative walk with a `seen` fence: a corrupt/racy ppid chain could in
      // principle present a cycle, and a recursive descent would then overflow
      // the stack instead of reporting ports.
      const queue = [target.rootPid];
      while (queue.length > 0) {
        const pid = queue.pop()!;
        if (pids.has(pid)) continue;
        pids.add(pid);
        for (const child of children.get(pid) ?? []) queue.push(child);
      }
    }
    subtrees.set(target.id, pids);
  }
  return subtrees;
}

// ── Listening sockets, however the platform names them ─────────────────

/** A listening TCP socket as the join needs it: which port, bound how, and the
 *  handle that ties it to a process — the socket INODE on linux (joined through
 *  `/proc/<pid>/fd`), the owning PID on darwin (netstat reports it directly). */
interface Listener {
  port: number;
  wildcard: boolean;
}

/** Fold a subtree's listeners into the sorted, deduplicated `PortInfo` set that
 *  rides the snapshot.
 *
 *  Three collapses happen here, and each has a concrete cause:
 *   - a **fork-inherited** listening socket is held by several pids at once, so
 *     the same (port, name) arrives repeatedly;
 *   - a **dual-stack** server shows up once in `tcp` and again in `tcp6` (or as
 *     `tcp46`) for one logical port;
 *   - a server bound to BOTH `0.0.0.0` and a specific address contributes two
 *     rows for one port.
 *
 *  The last is why `wildcard` folds with OR rather than picking a row: the
 *  question a chip asks is "is this reachable from another machine as-is?", and
 *  one any-address bind is enough to make the answer yes. Sorted by port so an
 *  unchanged host produces a BYTE-identical sample and `portsEqual` can dedup it
 *  away — an unsorted set would defeat the churn guard on `Set` iteration order
 *  alone. */
export function foldPorts(
  rows: readonly (Listener & { name: string })[],
): PortInfo[] {
  const byPort = new Map<number, PortInfo>();
  for (const row of rows) {
    const prior = byPort.get(row.port);
    if (prior === undefined) {
      byPort.set(row.port, {
        port: row.port,
        name: row.name,
        wildcard: row.wildcard,
      });
      continue;
    }
    if (row.wildcard) prior.wildcard = true;
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

// ── linux: /proc ───────────────────────────────────────────────────────

/** LISTEN, as `/proc/net/tcp`'s `st` column spells it. */
const TCP_LISTEN_STATE = "0A";

/** Decode one `/proc/net/tcp{,6}` hex address into its bytes in NETWORK order.
 *
 *  The kernel prints each 32-bit word in HOST byte order, so on every machine
 *  kolu runs on `127.0.0.1` appears as `0100007F` and an IPv6 address as four
 *  independently byte-reversed words. Reversing per 4-byte group (not across the
 *  whole string) is what makes a v4-mapped address come out as
 *  `00…00 FF FF <v4>` rather than gibberish. */
export function decodeProcAddress(hex: string): number[] {
  if (hex.length % 8 !== 0 || hex.length === 0 || !/^[0-9A-Fa-f]+$/.test(hex)) {
    throw new PortScanError(
      `port scan: "${hex}" is not a /proc/net/tcp address (expected 8 or 32 hex digits)`,
    );
  }
  const bytes: number[] = [];
  for (let word = 0; word < hex.length; word += 8) {
    for (let byte = 3; byte >= 0; byte--) {
      bytes.push(
        Number.parseInt(hex.slice(word + byte * 2, word + byte * 2 + 2), 16),
      );
    }
  }
  return bytes;
}

/** Is this the ANY address — `0.0.0.0`, `::`, or the v4-mapped `::ffff:0.0.0.0`?
 *  The v4-mapped arm is not hypothetical: a Node server that binds `0.0.0.0` on
 *  a dual-stack box is commonly reported in `tcp6` in exactly that form, and
 *  reading it as a specific address would offer a needless forward for a port
 *  that already answers. */
export function isAnyAddress(bytes: readonly number[]): boolean {
  if (bytes.every((b) => b === 0)) return true;
  return (
    bytes.length === 16 &&
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff &&
    bytes.slice(12).every((b) => b === 0)
  );
}

/** A `/proc/net/tcp{,6}` LISTEN row, keyed by the socket inode the fd walk joins
 *  against. */
export interface ProcListener extends Listener {
  inode: string;
}

/** Parse the LISTEN rows out of a `/proc/net/tcp` or `/proc/net/tcp6` body.
 *
 *  Columns: `sl local_address rem_address st tx:rx tr tm->when retrnsmt uid
 *  timeout inode …`. Fails LOUDLY on a row it cannot read rather than skipping
 *  it: a silently-dropped row is a port that never gets a chip, with nothing
 *  anywhere to say why. */
export function parseProcNetTcp(body: string): ProcListener[] {
  const lines = body.split("\n");
  const header = lines.findIndex((l) => l.includes("local_address"));
  if (header === -1) {
    throw new PortScanError(
      "port scan: /proc/net/tcp had no `local_address` header row",
    );
  }
  const listeners: ProcListener[] = [];
  for (const line of lines.slice(header + 1)) {
    if (line.trim() === "") continue;
    const cols = line.trim().split(/\s+/);
    // 10 fixed columns through `inode`; anything after it (refcount, pointer,
    // the retransmit detail) varies by kernel and is none of our business.
    if (cols.length < 10) {
      throw new PortScanError(
        `port scan: unreadable /proc/net/tcp row (${cols.length} columns): ${line.trim()}`,
      );
    }
    if (cols[3] !== TCP_LISTEN_STATE) continue;
    const local = cols[1]!;
    const split = local.lastIndexOf(":");
    if (split === -1) {
      throw new PortScanError(
        `port scan: "${local}" is not a /proc/net/tcp local_address (expected <hex>:<hex-port>)`,
      );
    }
    const port = Number.parseInt(local.slice(split + 1), 16);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new PortScanError(
        `port scan: "${local}" carries no valid port in a /proc/net/tcp row`,
      );
    }
    listeners.push({
      port,
      wildcard: isAnyAddress(decodeProcAddress(local.slice(0, split))),
      inode: cols[9]!,
    });
  }
  return listeners;
}

/** Parse `pid`, `ppid` and `comm` out of a `/proc/<pid>/stat` body.
 *
 *  `comm` is the one field that cannot be split on whitespace: it is
 *  parenthesized and may contain spaces AND parentheses (`(my prog (2))`), so
 *  the fields after it are read from the LAST `)` onward — the standard parse,
 *  and the reason this is not a `.split(/\s+/)`. */
export function parseProcStat(body: string): ProcessRow {
  const open = body.indexOf("(");
  const close = body.lastIndexOf(")");
  if (open === -1 || close === -1 || close < open) {
    throw new PortScanError(
      `port scan: unreadable /proc/<pid>/stat body: ${body.slice(0, 80)}`,
    );
  }
  const pid = Number.parseInt(body.slice(0, open).trim(), 10);
  const name = body.slice(open + 1, close);
  // After `)`: state, ppid, … — so ppid is the SECOND field of the remainder.
  const rest = body
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const ppid = Number.parseInt(rest[1] ?? "", 10);
  if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
    throw new PortScanError(
      `port scan: /proc/<pid>/stat had no pid/ppid pair: ${body.slice(0, 80)}`,
    );
  }
  return { pid, ppid, name };
}

/** Every numeric `/proc/<pid>` entry's `{pid, ppid, comm}`.
 *
 *  A pid that vanishes mid-read is dropped (the scan races exit constantly). An
 *  unreadable pid is dropped too UNLESS it is one of `roots` — a terminal we were
 *  asked about, where blindness must be loud rather than empty. */
async function linuxProcessTable(
  roots: ReadonlySet<number>,
): Promise<ProcessRow[]> {
  const entries = await readdir("/proc").catch((err: unknown) => {
    throw new PortScanError("port scan: /proc is unreadable", { cause: err });
  });
  const rows: ProcessRow[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let body: string;
    try {
      body = await readFile(`/proc/${entry}/stat`, "utf8");
    } catch (err) {
      const code = errnoOf(err);
      // ENOENT is the exit race, on a root pid as much as any other: the
      // terminal's shell is genuinely gone, so "no ports" is the truth.
      if (code === "ENOENT" || code === "ESRCH") continue;
      if (roots.has(Number(entry))) {
        throw new PortScanError(
          `port scan: cannot read /proc/${entry}/stat for a requested terminal root (${code})`,
          { cause: err },
        );
      }
      continue;
    }
    rows.push(parseProcStat(body));
  }
  return rows;
}

/** The PROGRAM name to show for a linux pid — `argv[0]`'s basename from
 *  `/proc/<pid>/cmdline`, falling back to the `comm` the pid table already read.
 *
 *  `comm` alone is wrong often enough to matter: it is the THREAD name, and a
 *  runtime that names its threads overwrites it. Measured here — a plain
 *  `node -e 'http.createServer(…).listen(…)'` reports `comm` as **`MainThread`**,
 *  so every Node dev server (the single most common thing this feature exists to
 *  find) would be labelled `MainThread` instead of `node`. `cmdline` is not
 *  rewritten that way.
 *
 *  Read only for the pids that actually hold a listening socket — a handful, not
 *  the whole table — so this costs nothing on a box serving nothing. The
 *  cmdline→comm order is `socketHolder.ts`'s, reused rather than re-invented. */
async function linuxProcessName(pid: number, comm: string): Promise<string> {
  try {
    const cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
    // NUL-separated argv. An empty cmdline is a kernel thread, which cannot own a
    // TCP listener — but if one ever reaches here, `comm` is the honest answer.
    const argv0 = cmdline.split("\0")[0];
    return argv0 !== undefined && argv0 !== "" ? path.basename(argv0) : comm;
  } catch {
    // The process exited between the socket join and this read — the routine
    // mid-scan race. The name is cosmetic; the port is the fact.
    return comm;
  }
}

/** What to do when `/proc/<pid>/fd` cannot be listed. The whole policy, as one
 *  pure decision, because getting it wrong is not a small mistake:
 *
 *   - **The exit race** (`ENOENT`/`ESRCH`) — the process is gone. Skip it; it
 *     holds nothing, which is the truth.
 *   - **A foreign-uid DESCENDANT** (`EACCES`/`EPERM`) — skip that pid. A
 *     setuid-root child is routine, not exotic: `sudo` sitting at its password
 *     prompt is root-owned with an unreadable `fd/` (measured), and so is any
 *     `su`/`pkexec`/setuid `ping`. Treating it as blindness took the WHOLE scan
 *     down — one `sudo nixos-rebuild` in one terminal emptied the Ports section
 *     for **every** terminal on the host and logged an ERROR every 5 s until the
 *     prompt was answered. The header's own reasoning already tolerates "another
 *     user's, unreadable" pids; the oversight was assuming they only appear
 *     OUTSIDE a subtree.
 *   - **A requested ROOT pid** — throw. That pid is a shell padi spawned itself,
 *     so it is padi's own uid; unreadable there means we genuinely cannot answer
 *     for that terminal, and answering "no ports" would be a lie shaped exactly
 *     like the truth.
 *
 *  The cost of skipping, stated: a listener held ONLY by a root-owned descendant
 *  is invisible. That is a real gap, and it is the better half of the trade —
 *  a `sudo` prompt holds no listening socket, while the alternative blinds every
 *  terminal on the box for as long as the prompt is open. */
export function fdListFailure(
  code: string | undefined,
  isRequestedRoot: boolean,
): "skip" | "throw" {
  if (code === "ENOENT" || code === "ESRCH") return "skip";
  if ((code === "EACCES" || code === "EPERM") && !isRequestedRoot)
    return "skip";
  return "throw";
}

/** The socket inodes a pid holds open, via the `/proc/<pid>/fd` readlink
 *  technique (`socketHolder.ts`'s, reused rather than re-derived).
 *
 *  Returns `undefined` when this pid cannot be inspected — an exited process, or
 *  a foreign-uid descendant. See {@link fdListFailure} for which failures are
 *  which, and why only a REQUESTED ROOT's unreadable `fd/` is fatal. */
async function socketInodesOf(
  pid: number,
  isRequestedRoot: boolean,
): Promise<Set<string> | undefined> {
  let fds: string[];
  try {
    fds = await readdir(`/proc/${pid}/fd`);
  } catch (err) {
    if (fdListFailure(errnoOf(err), isRequestedRoot) === "skip")
      return undefined;
    throw new PortScanError(
      `port scan: cannot list /proc/${pid}/fd for a requested terminal root (${errnoOf(err)})`,
      { cause: err },
    );
  }
  const inodes = new Set<string>();
  for (const fd of fds) {
    let target: string;
    try {
      target = await readlink(`/proc/${pid}/fd/${fd}`);
    } catch (err) {
      // A descriptor closed between the readdir and the readlink — the same exit
      // race one level down. The permission arms ride the same policy as the
      // listing above: a process that turned setuid between the readdir and this
      // read is the descendant case arriving one level late, and it must not take
      // the host's whole scan with it.
      if (fdListFailure(errnoOf(err), isRequestedRoot) === "skip") continue;
      throw new PortScanError(
        `port scan: cannot read /proc/${pid}/fd/${fd} (${errnoOf(err)})`,
        { cause: err },
      );
    }
    const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
    if (inode !== undefined) inodes.add(inode);
  }
  return inodes;
}

async function scanLinux(
  targets: readonly PortScanTarget[],
): Promise<Map<TerminalId, PortInfo[]>> {
  const roots = new Set(targets.map((t) => t.rootPid));
  const [table, v4, v6] = await Promise.all([
    linuxProcessTable(roots),
    readFile("/proc/net/tcp", "utf8"),
    // A kernel built without IPv6 has no tcp6 file at all; that is a real
    // absence of v6 sockets, not a failed read, so it folds to no rows.
    readFile("/proc/net/tcp6", "utf8").catch((err: unknown) =>
      errnoOf(err) === "ENOENT" ? "" : Promise.reject(err),
    ),
  ]);
  const listeners = new Map<string, ProcListener>();
  for (const l of [
    ...parseProcNetTcp(v4),
    ...(v6 === "" ? [] : parseProcNetTcp(v6)),
  ]) {
    // One inode is one socket, so a repeated inode is the same listener seen
    // twice; keep the first and let `foldPorts` do the port-level collapse.
    if (!listeners.has(l.inode)) listeners.set(l.inode, l);
  }
  const nameOf = new Map(table.map((row) => [row.pid, row.name]));
  const subtrees = partitionSubtrees(table, targets);
  const out = new Map<TerminalId, PortInfo[]>();
  for (const [id, pids] of subtrees) {
    const rows: (Listener & { name: string })[] = [];
    for (const pid of pids) {
      const inodes = await socketInodesOf(pid, roots.has(pid));
      if (inodes === undefined) continue;
      const held = [...inodes]
        .map((inode) => listeners.get(inode))
        .filter((l): l is ProcListener => l !== undefined);
      if (held.length === 0) continue;
      // Only now — for a pid that really holds a listener — is the better name
      // worth a second read.
      const name = await linuxProcessName(pid, nameOf.get(pid) ?? String(pid));
      for (const listener of held) rows.push({ ...listener, name });
    }
    out.set(id, foldPorts(rows));
  }
  return out;
}

// ── darwin: ps + netstat ───────────────────────────────────────────────

/** Parse `ps -axo pid,ppid,comm` output.
 *
 *  `comm` is macOS's full executable PATH and may contain spaces, so it is the
 *  untouched remainder of the line and the name is its basename. A non-empty line
 *  that does not match throws — a `ps` whose shape changed must be a loud failure,
 *  not a silently short process table (which would mis-attribute ports to nobody). */
export function parsePsTable(body: string): ProcessRow[] {
  const lines = body.split("\n");
  const header = lines.findIndex(
    (l) => /\bPID\b/.test(l) && /\bPPID\b/.test(l),
  );
  if (header === -1) {
    throw new PortScanError("port scan: `ps` output had no PID/PPID header");
  }
  const rows: ProcessRow[] = [];
  for (const line of lines.slice(header + 1)) {
    if (line.trim() === "") continue;
    const m = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (m === null) {
      throw new PortScanError(`port scan: unreadable \`ps\` row: ${line}`);
    }
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      name: path.basename(m[3]!),
    });
  }
  return rows;
}

/** A darwin listener, keyed by the pid `lsof` reports for it. */
export interface LsofListener extends Listener {
  pid: number;
}

/** Is an `lsof` address the ANY address — reachable from another machine as-is? */
function isLsofAnyAddress(host: string): boolean {
  return host === "*" || host === "::" || host === "0.0.0.0";
}

/** Parse `lsof -nP -w -iTCP -sTCP:LISTEN -Fpcn` field output.
 *
 *  Field output rather than the human table because it is the format lsof
 *  documents as machine-readable: one field per line, tagged by its first
 *  character, so nothing depends on column widths or on a process name that
 *  contains a space. `p` opens a process set, `f` opens a file within it, `n` is
 *  the address:
 *
 *      p27688 · c.emanote-wrapped · f57 · n127.0.0.1:5566 · f60 · n*:8079
 *
 *  `-sTCP:LISTEN` means every `n` here is already a listener, so there is no state
 *  column to filter on. Addresses are `HOST:PORT` with the port after the LAST
 *  colon — IPv6 hosts are bracketed (`[::1]:5173`), which is what makes that
 *  unambiguous. */
export function parseLsofListeners(body: string): LsofListener[] {
  const listeners: LsofListener[] = [];
  let pid: number | undefined;
  for (const line of body.split("\n")) {
    if (line === "") continue;
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isInteger(parsed)) {
        throw new PortScanError(
          `port scan: unreadable lsof pid field: ${line}`,
        );
      }
      pid = parsed;
      continue;
    }
    if (tag !== "n") continue;
    if (pid === undefined) {
      throw new PortScanError(
        `port scan: lsof reported an address before any process: ${line}`,
      );
    }
    const split = value.lastIndexOf(":");
    if (split === -1) {
      throw new PortScanError(
        `port scan: "${value}" is not an lsof listening address (expected HOST:PORT)`,
      );
    }
    const port = Number.parseInt(value.slice(split + 1), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new PortScanError(
        `port scan: "${value}" carries no valid port in an lsof LISTEN row`,
      );
    }
    // `[::1]` → `::1`; a v4 host and `*` are unbracketed already.
    const host = value.slice(0, split).replace(/^\[|\]$/g, "");
    listeners.push({ port, wildcard: isLsofAnyAddress(host), pid });
  }
  return listeners;
}

/** Run a darwin helper by ABSOLUTE path.
 *
 *  The path is absolute on purpose. kolu's macOS users run nix, and a
 *  nix-provided `ps` on `PATH` is procps — whose `-o comm` is a truncated name,
 *  not the executable path this parser reads. Resolving these through `PATH` makes
 *  the scan's correctness depend on the user's profile; naming the system binary
 *  makes it depend on macOS. */
async function runDarwin(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: PORT_SCAN_COMMAND_TIMEOUT_MS,
      // A 1000-process box's `ps` is ~110 KB; this is headroom, and a genuine
      // overflow must fail rather than truncate into a short port list.
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    // lsof exits 1 when it found nothing — a box serving no ports at all. That is
    // an ANSWER, not a failure, and it is distinguishable: lsof writes nothing to
    // either stream. A code-1 exit that DID say something is a real error and
    // falls through to the throw.
    const e = err as { code?: unknown; stdout?: string; stderr?: string };
    if (e.code === 1 && e.stdout === "" && e.stderr === "") return "";
    throw new PortScanError(
      `port scan: \`${command} ${args.join(" ")}\` failed (${errnoOf(err) ?? "non-zero exit"})`,
      { cause: err },
    );
  }
}

/** macOS's own `ps` and `lsof` — see {@link runDarwin} for why these are absolute. */
const DARWIN_PS = "/bin/ps";
const DARWIN_LSOF = "/usr/sbin/lsof";

async function scanDarwin(
  targets: readonly PortScanTarget[],
): Promise<Map<TerminalId, PortInfo[]>> {
  const [ps, lsof] = await Promise.all([
    runDarwin(DARWIN_PS, ["-axo", "pid,ppid,comm"]),
    // `-n`/`-P` keep it from resolving DNS and port names (both would be slow and
    // neither is wanted); `-w` suppresses warnings so stderr means something.
    runDarwin(DARWIN_LSOF, ["-nP", "-w", "-iTCP", "-sTCP:LISTEN", "-Fpcn"]),
  ]);
  const table = parsePsTable(ps);
  const nameOf = new Map(table.map((row) => [row.pid, row.name]));
  const byPid = new Map<number, Listener[]>();
  for (const l of parseLsofListeners(lsof)) {
    const held = byPid.get(l.pid);
    if (held === undefined) byPid.set(l.pid, [l]);
    else held.push(l);
  }
  const out = new Map<TerminalId, PortInfo[]>();
  for (const [id, pids] of partitionSubtrees(table, targets)) {
    const rows: (Listener & { name: string })[] = [];
    for (const pid of pids) {
      for (const listener of byPid.get(pid) ?? []) {
        rows.push({ ...listener, name: nameOf.get(pid) ?? String(pid) });
      }
    }
    out.set(id, foldPorts(rows));
  }
  return out;
}

// ── The one entry point ────────────────────────────────────────────────

/** Scan the host once and return each requested terminal's listening ports,
 *  sorted and deduplicated. Every requested id is present in the result (with an
 *  empty array when it serves nothing), so a caller can publish the whole set
 *  without asking which ids were covered.
 *
 *  Throws `PortScanError` on an unsupported platform — fail fast, exactly as
 *  `socketHolders` does: kolu's daemons run on linux and darwin, and a third
 *  platform needs a real reader, not a silent empty map. */
export function scanTerminalPorts(
  targets: readonly PortScanTarget[],
): Promise<Map<TerminalId, PortInfo[]>> {
  if (targets.length === 0) return Promise.resolve(new Map());
  switch (process.platform) {
    case "linux":
      return scanLinux(targets);
    case "darwin":
      return scanDarwin(targets);
    default:
      throw new PortScanError(
        `port scan: unsupported platform '${process.platform}' — kolu daemons run on linux/darwin only`,
      );
  }
}
