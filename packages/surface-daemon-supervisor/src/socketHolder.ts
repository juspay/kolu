/**
 * `socketHolders` — ask the OS which process(es) hold a given unix-socket PATH.
 *
 * The supervisor's third pid-lifecycle leaf, beside `waitForPidGone` (is a pid
 * gone?) and the gate's `isHolderLive` (is a pid alive?): this one answers *who
 * listens on this exact socket path* — the identity source the gate-less-squatter
 * recovery needs. The gate names the daemon only while the pidfile survives; when
 * the gate is gone but a live orphan still holds the rendezvous socket, the OS is
 * the only remaining witness of who that holder is.
 *
 * It is a **leaf**, not electricity: it hides a bounded, platform-specific lookup
 * (parse `/proc/net/unix` on linux; shell `lsof` on darwin) with no transport,
 * reconnect, or persistence lifecycle of its own — so it lives in the package that
 * consumes it, next to `waitForPidGone`, not in a new `@kolu/*` receptacle.
 *
 * **Why a LIST, not a single pid.** On linux the bound listener is the one row in
 * `/proc/net/unix` that carries the path, so the answer is exact and singular. But
 * `lsof` on darwin can report several fds against one socket path (the listener
 * plus any connected clients), and telling listener from client there is not
 * reliable. So the leaf returns *every* pid the OS says holds the path, and the
 * caller's handshake — which self-reports the daemon's own pid — selects the true
 * listener from the set (the recovery kills only a pid the OS corroborates AND the
 * daemon named over the socket). That keeps the leaf honest on both platforms
 * without it having to guess listener-vs-client.
 *
 * **Fail fast on an unknown platform.** kolu's daemons run on linux and darwin
 * only; an unsupported platform throws rather than silently returning "nobody
 * holds it" (which would degrade the recovery into an unconditional respawn over a
 * squatter it never identified) — the no-fallbacks rule at the OS boundary.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

/** A process the OS reports as holding a socket path — its pid and a human
 *  command label (for the foreign-holder error that must name the culprit). */
export interface SocketHolder {
  pid: number;
  /** A readable command string for the pid — `/proc/<pid>/cmdline` on linux, the
   *  `lsof` command name on darwin; `"?"` if it could not be read (the pid may
   *  have exited between the lookup and the read). Diagnostic only. */
  command: string;
}

/** Every process the OS reports as holding the unix socket at `socketPath`
 *  (empty if none — the socket is unbound / already gone). Never throws for a
 *  missing socket or an unreadable `/proc` entry; DOES throw on an unsupported
 *  platform (fail fast — see the module header). */
export function socketHolders(socketPath: string): SocketHolder[] {
  switch (process.platform) {
    case "linux":
      return linuxSocketHolders(socketPath);
    case "darwin":
      return darwinSocketHolders(socketPath);
    default:
      throw new Error(
        `socketHolders: unsupported platform '${process.platform}' — kolu daemons run on linux/darwin only`,
      );
  }
}

/** Linux: the bound listener is the one `/proc/net/unix` row whose trailing PATH
 *  column equals `socketPath` (connected client sockets carry no path, and only
 *  the bound socket sets the `SO_ACCEPTCON` flag). Its Inode column then maps to
 *  the owning pid by scanning `/proc/<pid>/fd/*` for a symlink to `socket:[<inode>]`.
 *  Exact and singular — the empirically-grounded parse. */
function linuxSocketHolders(socketPath: string): SocketHolder[] {
  let raw: string;
  try {
    raw = readFileSync("/proc/net/unix", "utf8");
  } catch {
    return [];
  }
  // Columns: Num RefCount Protocol Flags Type St Inode Path. The path is the LAST
  // column and MAY contain spaces (a caller-supplied `--pty-host-socket` path), so
  // split off the seven fixed whitespace-delimited fields and take the untouched
  // remainder as the path — a plain `.split(/\s+/)[7]` would truncate `/tmp/my
  // state/pty-host.sock` to `/tmp/my`. A row without a path (a connected peer) has
  // no 8th group and is skipped. The path uniquely names the bound socket, so no
  // flag disambiguation is needed.
  const rowRe = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(.+)$/;
  const inodes = new Set<string>();
  for (const line of raw.split("\n")) {
    const m = rowRe.exec(line.trim());
    if (m === null) continue;
    const [, inode, path] = m;
    if (path !== socketPath) continue;
    if (inode) inodes.add(inode);
  }
  if (inodes.size === 0) return [];

  const wanted = new Set([...inodes].map((i) => `socket:[${i}]`));
  const holders: SocketHolder[] = [];
  let pids: string[];
  try {
    pids = readdirSync("/proc");
  } catch {
    return [];
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    let fds: string[];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue; // the process exited, or is not ours to inspect
    }
    for (const fd of fds) {
      let target: string;
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      if (wanted.has(target)) {
        holders.push({ pid: Number(pid), command: linuxCommand(pid) });
        break;
      }
    }
  }
  return holders;
}

/** A readable command for a linux pid: `/proc/<pid>/cmdline` (NUL-separated argv,
 *  joined with spaces), falling back to `/proc/<pid>/comm`, then `"?"`. */
function linuxCommand(pid: string): string {
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .split("\0")
      .filter((s) => s.length > 0);
    if (argv.length > 0) return argv.join(" ");
  } catch {
    // fall through
  }
  try {
    return readFileSync(`/proc/${pid}/comm`, "utf8").trim() || "?";
  } catch {
    return "?";
  }
}

/** Darwin: `lsof` is the only portable witness (no `/proc`). `-F pcn` prints a
 *  machine-readable set of records — `p<pid>`, `c<command>`, `n<name>` — one per
 *  open fd; we keep the pids whose `n` (name) equals the socket path. `lsof` can
 *  list the listener AND connected clients here, so the result may hold several
 *  pids; the caller's handshake-reported pid selects the true listener from the
 *  set. Exits non-zero (and prints nothing) when no process holds the path, which
 *  we read as "no holders", not an error. */
function darwinSocketHolders(socketPath: string): SocketHolder[] {
  let out: string;
  try {
    // -w silence warnings, -n/-P skip name resolution (faster, and we match a
    // literal path), -F pcn machine-readable fields. The path is passed as a
    // filter argument so lsof only reports fds against this exact socket.
    out = execFileSync(
      "lsof",
      ["-w", "-n", "-P", "-F", "pcn", "--", socketPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    // Non-zero exit is lsof's normal "nothing matched" signal (or lsof absent);
    // either way there is no holder we can name — return empty, don't throw.
    return [];
  }
  // lsof -F emits records line-by-line: a `p<pid>` starts a process block, `c` is
  // its command, and each `f<fd>`/`n<name>` describes one of its fds. Attribute a
  // holder when a block has an `n` equal to the socket path.
  const holders: SocketHolder[] = [];
  let curPid: number | undefined;
  let curCmd = "?";
  let matched = false;
  const flush = (): void => {
    if (curPid !== undefined && matched) {
      holders.push({ pid: curPid, command: curCmd });
    }
  };
  for (const line of out.split("\n")) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === "p") {
      flush();
      curPid = Number(val);
      curCmd = "?";
      matched = false;
    } else if (tag === "c") {
      curCmd = val || "?";
    } else if (tag === "n") {
      if (val === socketPath) matched = true;
    }
  }
  flush();
  // De-dup: one process can hold the path on multiple fds.
  const seen = new Set<number>();
  const unique: SocketHolder[] = [];
  for (const h of holders) {
    if (seen.has(h.pid)) continue;
    seen.add(h.pid);
    unique.push(h);
  }
  return unique;
}
