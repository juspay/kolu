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
 *
 * **Async, and bounded.** The lookup is invoked from the daemon boot / recovery
 * path, which runs on the same event loop that serves live terminals. So it uses
 * async `fs.promises` for the `/proc` walk (never a synchronous full-tree scan that
 * blocks every terminal's I/O), and darwin's `lsof` runs under a hard `timeout`
 * (a wedged `lsof` on a contended mount must reject, never hang the loop forever).
 */

import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Hard ceiling on the darwin `lsof` subprocess — a wedged `lsof` (contended mount,
 *  slow box) must be killed and rejected, never left to hang the serving event loop.
 *
 *  The same number as padi's `PORT_SCAN_COMMAND_TIMEOUT_MS` (`portScan.ts`), which
 *  runs the same binary for its own question; the two are cross-named because the
 *  socket↔pid reading is re-derived in both places rather than shared. */
const LSOF_TIMEOUT_MS = 5_000;

/** macOS's OWN `lsof`, by ABSOLUTE path. kolu's macOS users run nix, so `lsof` on
 *  `PATH` may be a different build than the system one this parse was verified
 *  against — resolving it through `PATH` would make a boot-path check's correctness
 *  depend on the user's profile. Same call, same reason, as `portScan.ts`'s
 *  `DARWIN_LSOF`. */
const DARWIN_LSOF = "/usr/sbin/lsof";

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
export function socketHolders(socketPath: string): Promise<SocketHolder[]> {
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
async function linuxSocketHolders(socketPath: string): Promise<SocketHolder[]> {
  let raw: string;
  try {
    raw = await readFile("/proc/net/unix", "utf8");
  } catch {
    return [];
  }
  // Columns: Num RefCount Protocol Flags Type St Inode Path. The path is the LAST
  // column and MAY contain spaces — INTERNAL or TRAILING — (a caller-supplied
  // `--pty-host-socket` path), so match the seven fixed whitespace-delimited fields
  // and take the untouched remainder as the path: a plain `.split(/\s+/)[7]` would
  // truncate `/tmp/my state/pty-host.sock`, and a `.trim()` would corrupt a path
  // ending in a space. Leading structural whitespace is consumed by `^\s*` (NOT a
  // trim, which would also eat the trailing path char); `(.+)$` keeps the rest
  // verbatim. A row without a path (a connected peer) has no 8th group and is
  // skipped. The path uniquely names the bound socket, so no flag disambiguation.
  const rowRe = /^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\S+)\s+(.+)$/;
  const inodes = new Set<string>();
  for (const line of raw.split("\n")) {
    const m = rowRe.exec(line);
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
    pids = await readdir("/proc");
  } catch {
    return [];
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    let fds: string[];
    try {
      fds = await readdir(`/proc/${pid}/fd`);
    } catch {
      continue; // the process exited, or is not ours to inspect
    }
    for (const fd of fds) {
      let target: string;
      try {
        target = await readlink(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      if (wanted.has(target)) {
        holders.push({ pid: Number(pid), command: await linuxCommand(pid) });
        break;
      }
    }
  }
  return holders;
}

/** A readable command for a linux pid: `/proc/<pid>/cmdline` (NUL-separated argv,
 *  joined with spaces), falling back to `/proc/<pid>/comm`, then `"?"`. */
async function linuxCommand(pid: string): Promise<string> {
  try {
    const argv = (await readFile(`/proc/${pid}/cmdline`, "utf8"))
      .split("\0")
      .filter((s) => s.length > 0);
    if (argv.length > 0) return argv.join(" ");
  } catch {
    // fall through
  }
  try {
    return (await readFile(`/proc/${pid}/comm`, "utf8")).trim() || "?";
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
async function darwinSocketHolders(
  socketPath: string,
): Promise<SocketHolder[]> {
  let out: string;
  try {
    // -w silence warnings, -n/-P skip name resolution (faster, and we match a
    // literal path), -F pcn machine-readable fields. The path is passed as a
    // filter argument so lsof only reports fds against this exact socket. Async +
    // a hard `timeout` so a wedged lsof is SIGKILLed and rejected, never hanging
    // the serving event loop.
    ({ stdout: out } = await execFileP(
      DARWIN_LSOF,
      ["-w", "-n", "-P", "-F", "pcn", "--", socketPath],
      // `killSignal` is explicit because the comment above promises a SIGKILL and
      // `execFile`'s default is SIGTERM — which a wedged lsof (the only case this
      // timer exists for) is entitled to ignore, making the timeout advisory.
      { encoding: "utf8", timeout: LSOF_TIMEOUT_MS, killSignal: "SIGKILL" },
    ));
  } catch {
    // Non-zero exit is lsof's normal "nothing matched" signal (or lsof absent, or
    // the timeout SIGKILL); either way there is no holder we can name — return
    // empty, don't throw.
    return [];
  }
  // lsof -F emits records line-by-line: a `p<pid>` starts a process block, `c` is
  // its command, and each `f<fd>`/`n<name>` describes one of its fds. Attribute a
  // holder when a block has an `n` equal to the socket path.
  // De-dup as we accumulate: one process can hold the path on multiple fds, so
  // `flush` skips a pid already recorded rather than a second post-pass.
  const holders: SocketHolder[] = [];
  const seen = new Set<number>();
  let curPid: number | undefined;
  let curCmd = "?";
  let matched = false;
  const flush = (): void => {
    if (curPid !== undefined && matched && !seen.has(curPid)) {
      seen.add(curPid);
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
  return holders;
}
