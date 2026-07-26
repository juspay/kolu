/**
 * ONE host-wide pass that answers "what is each of these process subtrees
 * serving?" by joining the host's listening TCP sockets to each requested root
 * pid's descendants.
 *
 * The volatility this package exists to hide is the OS itself: how a kernel will
 * tell you which processes hold listening sockets. This repo has already varied
 * along that axis three times on darwin alone — `netstat`, then `ps` + `lsof`,
 * now a libproc helper — and linux answers by an entirely different mechanism
 * (`/proc` read directly), in an entirely different byte order. Consumers plug
 * into `scanSubtreePorts` and never learn which.
 *
 * Its only input is a list of ROOT PIDS, so it needs no PTY, no terminal, and no
 * app identity — see {@link scanSubtreePorts} on why the pid → caller-identity
 * join deliberately stays outside.
 *
 * ## The discipline (all three are load-bearing, not style)
 *
 *  - **No OS state between ticks.** Parse, join, emit the structural `PortInfo`
 *    set, drop everything else. No retained fds, no process objects, no cached
 *    pid table. A scanner that keeps fds open to "go faster" is how a port
 *    watcher becomes the thing holding a dead server's socket alive.
 *  - **Repartition from the CURRENT root pids every tick.** The subtree map is
 *    rebuilt from the caller's live target list on every pass, so a root
 *    appearing, exiting, or being re-keyed can never leave a stale subtree behind.
 *  - **Attribution is the live ppid subtree, and nothing more.** Backgrounded
 *    (`&`) jobs, pipelines and grandchildren all keep the root as an ancestor,
 *    so the walk sees them. A TRUE daemon (setsid / double-fork, reparented to
 *    init) has LEFT the subtree and is deliberately invisible here — no
 *    session-id heuristics, no host-wide orphan matching. If you daemonized it,
 *    it is no longer this subtree's server.
 *
 * ## Errors: a blind scan must never look like an empty one
 *
 * Per-pid `ENOENT` is EXPECTED — a scan races process exit constantly. So is an
 * unreadable pid that is **not ours**, and that includes pids INSIDE a subtree:
 * a setuid-root child (`sudo` at its password prompt, `su`, `pkexec`) is a
 * routine descendant of an ordinary shell, and its `/proc/<pid>/fd` is `EACCES`
 * to us. Both are skipped.
 *
 * The one fatal case is an unreadable **requested ROOT** pid. A caller asks about
 * roots it owns — processes it spawned, so its own uid — and unreadable there
 * means we genuinely cannot answer for that root, where answering "no ports"
 * would be a lie shaped exactly like the truth. That throws
 * (`caught-error-must-not-collapse-to-empty`).
 *
 * Getting that distinction wrong is not a small mistake, and this file had it
 * wrong: every in-subtree `EACCES` threw, so one `sudo` password prompt in one
 * terminal emptied kolu's Ports section for **every** terminal on the host — and
 * kept it empty, with an ERROR every 5 s, until the prompt was answered. See
 * {@link procReadFailure}.
 *
 * ## Why these two mechanisms
 *
 * On linux, `/proc` is read directly: `ss` measured ~7x slower AND hides other
 * users' pid attribution.
 *
 * On darwin the mechanism is a **libproc helper we build** — see
 * `packages/port-scan/native/portScanDarwin.c` and its derivation beside it. It replaced
 * a `ps` + `lsof` pair, and the numbers are not close. Measured on zest (macOS 27.0,
 * build 26A5388g, ~835 processes, 10-run medians, spawn-to-exit):
 *
 *  | mechanism                   | median  |
 *  |-----------------------------|---------|
 *  | this helper                 | **8.5 ms**  |
 *  | this helper, +100 listeners | 9.4 ms  |
 *  | `/bin/ps` ALONE             | 49 ms   |
 *  | `/usr/sbin/lsof` ALONE      | 94 ms   |
 *
 * So the old path cost ~143 ms of subprocess before a byte was parsed, for facts
 * libproc hands over in one call — `ps` and `lsof` are themselves libproc clients.
 * Re-measured on the shipped derivation at 10.6 ms/run on a busier zest (866
 * processes), which is the number to beat, not to trust blindly.
 *
 * A maintained tool was researched rather than assumed away: `procs` **discards the
 * bind address** (a hard functional failure here — a loopback and an any-address
 * bind become the same row) and costs ~30 ms; `osquery` is ~378 ms and not packaged for darwin;
 * `rustnet` needs capture privileges. The decided end state is a small
 * `sysinfo`+`listeners` Rust wrapper shared with drishti, behind a proof gate — the
 * Atlas note records the gate and why this helper ships first.
 *
 * ### netstat: intermittently blind, which took two wrong write-ups to pin down
 *
 * The record here has been wrong in BOTH directions, so it is written as what was
 * actually observed rather than as a verdict.
 *
 * **Window A** (the original): macOS 27.0 `netstat -anv` returns an EMPTY internet
 * table while reporting success — zero bytes, exit 0, nothing on stderr;
 * `netstat -anv -f inet` returns 117 bytes of header and no rows.
 *
 * **Window B**: on the same box, the same `/usr/sbin/netstat -anv -p tcp` returns 29
 * LISTEN rows and `-anv` returns 241 KB. This was written up as "the original does not
 * reproduce" and the original was retracted. **That retraction was wrong** — it
 * generalised one sampling window into an absolute, which is the same error it accused
 * the original of.
 *
 * **Window C** (the fact-check that settled it): back to empty. Deterministic over six
 * back-to-back runs — `-anv -p tcp` 0 bytes / exit 0 / clean stderr, `-anv` 169 KB
 * containing ZERO tcp or udp rows (621 unix-domain rows; the internet tables are simply
 * absent), `-anv -f inet` **117 bytes**, matching window A to the byte. A pty does not
 * change it. At that same moment `lsof` and this module's helper each saw the same 22
 * listeners, and the box had NOT rebooted between B and C (up 1 d 12 h, one boot).
 *
 * So: macOS 27's netstat intermittently loses its internet tables while reporting
 * success — stable within a window, flipped between windows, **cause unknown**. Three
 * windows is not a mechanism, and no PATH confusion explains it (`command -v netstat`
 * resolved to `/usr/sbin/netstat` in every window).
 *
 * That is disqualifying on its own: a mechanism whose failure mode is "answers no ports,
 * successfully" is the worst possible one for a feature whose entire job is that
 * question, and it would fail INTERMITTENTLY, which is worse than failing always.
 *
 * A second, independently verified reason not to use it: netstat's `Local Address`
 * column is fixed-width and TRUNCATES (`fe80::c051:5eff:.49508` — address cut, port
 * glued on after a `.`), and the bind address is precisely what reachability is judged
 * from.
 *
 * Non-root visibility is the same as lsof had — own-uid pids only — and sufficient by
 * construction: a caller asks about roots it spawned, so the subtree runs as its own uid.
 *
 * ## What a pass actually costs
 *
 * The spike's "linux ~3 ms" was measured on a 30-process box and does not survive
 * a real one: this module's dominant cost is the HOST pid table, which scales with
 * the host's process count and not with how many roots were asked about. On a
 * 515-process box a full pass measured **35-57 ms** — an order of magnitude over
 * the figure the cadence argument was written against.
 *
 * That mattered more than it looks, because the effective cadence is not 5 s
 * either: kaval throttles its activity edge to one per PTY per 200 ms, so a single
 * streaming agent delivers ~5 edges/s and the nudge floor (≥1 s) becomes the real
 * period. ~40 ms every second, for the life of the daemon, is ~4% of a core.
 *
 * So the inner loops are batched rather than strictly serial — the pid table in
 * bounded groups, the fd walk concurrently per pid — which measured **14-18 ms** on
 * the same 515-process box. Darwin is now the FASTER platform at ~8.5-10.6 ms, since
 * its helper does the whole join in one libproc pass with no subprocess text to
 * parse.
 *
 * Either way the sampler no longer depends on these figures staying true: its nudge
 * floor is duty-cycle bounded (`nudgeFloorMs`), so a pass that gets slower stretches
 * its own cadence instead of taxing the box.
 *
 * The remaining order of magnitude is a KNOWN, recorded opportunity rather than a
 * mystery: `/proc/<pid>/task/<tid>/children` lets the walk descend from each
 * requested root instead of reading the whole host table (measured at <1 ms for two
 * subtrees), which would make the cost scale with subtree size — what the feature
 * is actually about. It is not taken here because it is a redesign of the walk, and
 * `proc(5)` warns `children` may be incomplete under churn; that is the same exit
 * race this module already tolerates by policy, so it is a decision to make
 * deliberately rather than at the end of a review pass. See the performance note.
 *
 * ## Both platforms are verified against a live OS, not just fixtures
 *
 * `scan.live.test.ts` spawns real listeners and asks this module about them,
 * on whatever platform it runs. That suite exists because fixtures pin the
 * PARSERS but cannot pin the assumption that the parser is handed the shape it
 * expects — and that gap produced a real bug: this file first looked for a
 * `netstat` header column called `pid`, and macOS calls it **`process:pid`** (value
 * `node:53082`), so every darwin scan threw while every fixture test stayed green.
 * Found by running it on a Mac, not by reading it.
 *
 * The netstat section above is the other half of that lesson, in reverse: a single
 * clean sampling window was written up as a refutation, and a later window put the
 * original observation back. An intermittent OS-level failure cannot be settled by
 * one re-run in either direction.
 *
 * The helper was proved the same way before it shipped: built on zest and checked
 * against `lsof` for all four bind shapes at once — `127.0.0.1`, `0.0.0.0`, `::1`,
 * and a DUAL-STACK `::` socket (`ipv6Only: false`). That last one is the case worth
 * naming: the helper's `insi_vflag & INI_IPV4` branch collapses it to its 4-byte v4
 * form, so `addressBind` calls it `any` and lsof agrees (`*:19304`). A reader
 * without that branch would report a 16-byte address there and the two would part
 * ways on exactly the case the v4-mapped arm exists for.
 */

import { execFile } from "node:child_process";
import { readdir, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Logger } from "@kolu/log";
import { foldPorts, TcpPortSchema } from "./ports.ts";
import type { PortFamily, PortInfo, PortScope } from "./ports.ts";

const execFileAsync = promisify(execFile);

/** How long a darwin `ps` / `lsof` may run before it is killed. macOS ships no
 *  GNU `timeout`, so the timer is Node's (`execFile`'s own `timeout`, which sends
 *  the kill signal) — a hung helper must not wedge the sampler's single-flight
 *  slot forever. Generous against the measured 17-93 ms so a loaded box is not
 *  mistaken for a hang.
 *
 *  The same number as `socketHolder.ts`'s `LSOF_TIMEOUT_MS`, for the same reason,
 *  in a second home — the duplication the `socketInodesOf` note tracks. Cross-named
 *  in both places so a change to one is at least FINDABLE from the other. */
export const PORT_SCAN_COMMAND_TIMEOUT_MS = 5_000;

/** How many `/proc/<pid>/stat` reads are in flight at once. Bounded rather than
 *  "all of them": the win is saturating libuv's small threadpool, which 64 already
 *  does, while an unbounded `Promise.all` over a 10 000-process host would queue
 *  10 000 threadpool items to no benefit. */
const PROC_READ_BATCH = 64;

/** A scan that did not answer — thrown so the caller reports the failure instead
 *  of publishing an empty port list that reads identically to "this subtree serves
 *  nothing".
 *
 *  TAGGED, because two failure axes with OPPOSITE correct responses arrive through
 *  this one type:
 *
 *   - `"blind"` — *this pass* could not see (an `EACCES` on a requested subtree, a
 *     malformed socket table, an `lsof` that timed out). Transient: hold the last
 *     sample and retry on the next tick.
 *   - `"unsupported-platform"` — this host can NEVER be read. Permanent, so a
 *     caller that retried it would log an error every 5 s forever, which is a
 *     caught error degrading into a loop rather than surfacing. The sampler stops
 *     and says so instead.
 *
 *  Untagged, the `async` entry point below routed the second into the first —
 *  exactly the collapse the fail-fast rule forbids. */
export class PortScanError extends Error {
  constructor(
    readonly kind: "blind" | "unsupported-platform",
    message: string,
    options?: { cause?: unknown },
  ) {
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

/** Partition the host's process table into one pid SET per requested ROOT pid.
 *
 *  Pure, so the walk is testable without a `/proc`. A pid can land in only one
 *  subtree (a process has one parent chain), and a root absent from the table
 *  yields an empty set — that process really is gone, which reads honestly as "no
 *  ports". Keyed by the ROOT PID, so two callers rooted at the same pid are one
 *  walk rather than two identical ones. */
export function partitionSubtrees(
  table: readonly ProcessRow[],
  rootPids: readonly number[],
): Map<number, Set<number>> {
  const children = new Map<number, number[]>();
  for (const row of table) {
    const siblings = children.get(row.ppid);
    if (siblings === undefined) children.set(row.ppid, [row.pid]);
    else siblings.push(row.pid);
  }
  const alive = new Set(table.map((row) => row.pid));
  const subtrees = new Map<number, Set<number>>();
  for (const rootPid of rootPids) {
    const pids = new Set<number>();
    if (alive.has(rootPid)) {
      // Iterative walk with a `seen` fence: a corrupt/racy ppid chain could in
      // principle present a cycle, and a recursive descent would then overflow
      // the stack instead of reporting ports.
      const queue = [rootPid];
      while (queue.length > 0) {
        const pid = queue.pop()!;
        if (pids.has(pid)) continue;
        pids.add(pid);
        for (const child of children.get(pid) ?? []) queue.push(child);
      }
    }
    subtrees.set(rootPid, pids);
  }
  return subtrees;
}

// ── Listening sockets, however the platform names them ─────────────────

/** A listening TCP socket as the join needs it: which port, and bound how.
 *
 *  The handle that ties a socket to a process is deliberately NOT in this base
 *  shape, because the two platforms key it differently: linux keys on the socket
 *  INODE (`ProcListener`, joined through `/proc/<pid>/fd`), darwin on the owning
 *  PID (`LsofListener`, which lsof reports in its `p` field). Each reader resolves
 *  its own key and hands the join a plain per-pid list. */
interface Listener {
  port: number;
  scope: PortScope;
  family: PortFamily;
}

// ── What a platform must answer, and the ONE join over it ───────────────

/** What a PLATFORM must be able to answer — and the whole of it. Nothing else
 *  about an OS reaches {@link joinSubtreePorts}, so the platform seam sits at the
 *  READING and the join is written once for both. (It used to be written twice,
 *  which is how the two arms drifted: only one of them resolved a listener-holding
 *  pid's better name.) */
interface HostReading {
  /** The host's process table — pid, ppid, own name. */
  table: readonly ProcessRow[];
  /** The listening sockets this pid holds, or `undefined` when the pid cannot be
   *  inspected at all (an exit race, a foreign-uid descendant) — see
   *  {@link procReadFailure} for which failures are which and why only a requested
   *  ROOT's is fatal. An inspectable pid holding nothing is an empty list. */
  listenersOf(pid: number): Promise<readonly Listener[] | undefined>;
  /** The PROGRAM name to show for a pid — asked only for a pid the join has
   *  already found to hold a listener, so a platform may pay for it there. */
  nameOf(pid: number): Promise<string>;
}

/** Join one host reading to the requested subtrees: partition the table, gather
 *  each subtree pid's listeners, name the pids that hold one, and collapse per
 *  root pid.
 *
 *  Platform-free by construction — it can only ask the three questions
 *  {@link HostReading} declares. */
async function joinSubtreePorts(
  reading: HostReading,
  rootPids: readonly number[],
): Promise<Map<number, PortInfo[]>> {
  const out = new Map<number, PortInfo[]>();
  for (const [rootPid, pids] of partitionSubtrees(reading.table, rootPids)) {
    const rows: PortInfo[] = [];
    for (const pid of pids) {
      const held = await reading.listenersOf(pid);
      if (held === undefined || held.length === 0) continue;
      const name = await reading.nameOf(pid);
      // Built field by field, not spread: a reader's own key (the socket inode,
      // the owning pid) is its business and must not ride out on the wire value.
      for (const l of held)
        rows.push({ port: l.port, scope: l.scope, family: l.family, name });
    }
    out.set(rootPid, foldPorts(rows));
  }
  return out;
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
  // EXACTLY v4 or v6 — the two widths `/proc/net/tcp{,6}` can print. The old
  // `% 8 !== 0` admitted 16 and 24 digits too, so a changed or corrupt row would
  // sail past this loud parser and be classified as a SPECIFIC bind (the safe-
  // looking answer) instead of faulting the pass.
  if ((hex.length !== 8 && hex.length !== 32) || !/^[0-9A-Fa-f]+$/.test(hex)) {
    throw new PortScanError(
      "blind",
      `port scan: "${hex}" is not a /proc/net/tcp address (expected exactly 8 or 32 hex digits)`,
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

/** Decode a bind address printed in NETWORK order — what the darwin helper emits,
 *  straight from the socket's `sockaddr` bytes.
 *
 *  Separate from {@link decodeProcAddress} on purpose, and the difference is one the
 *  types cannot catch: linux's `/proc` prints each 32-bit word in HOST order, so its
 *  decoder byte-swaps per word, while these bytes are already in the order the wire
 *  uses. Running helper output through the `/proc` decoder would swap bytes that
 *  need no swapping and turn `127.0.0.1` into `1.0.0.127` — a SPECIFIC address either
 *  way, so it would not throw; it would quietly mis-classify. Two decoders, ONE judge
 *  ({@link addressBind}) keeps the byte-order difference local and the
 *  reachability decision shared. */
export function decodeNetworkAddress(hex: string): number[] {
  if ((hex.length !== 8 && hex.length !== 32) || !/^[0-9A-Fa-f]+$/.test(hex)) {
    throw new PortScanError(
      "blind",
      `port scan: "${hex}" is not a bind address (expected exactly 8 or 32 hex digits)`,
    );
  }
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

/** The 4 bytes an IPv6 address carries a v4 address in when it is v4-MAPPED
 *  (`::ffff:a.b.c.d`), or `undefined` when it is not that shape. A Node server
 *  that binds `0.0.0.0` on a dual-stack box is commonly reported in `tcp6` in
 *  exactly this form, so a reader without this arm classifies a reachable
 *  wildcard as needing a forward. */
function mappedV4(bytes: readonly number[]): readonly number[] | undefined {
  if (bytes.length !== 16) return undefined;
  if (!bytes.slice(0, 10).every((b) => b === 0)) return undefined;
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return undefined;
  return bytes.slice(12);
}

/** WHERE a socket is bound, as the one classification both platforms share —
 *  the SINGLE judge behind every reachability decision downstream.
 *
 *  Over BYTES, so this one function answers for every spelling either platform
 *  produces: `/proc`'s host-order hex on linux and the helper's network-order hex
 *  on darwin. There is deliberately no second, text-shaped predicate — an earlier
 *  revision had one and the two disagreed about exactly the v4-mapped case, so
 *  darwin classified a reachable v4-mapped wildcard as needing a forward.
 *
 *  It answers BOTH questions a forward needs, and they are different questions:
 *  `scope` decides whether a door is needed at all, `family` decides what that
 *  door dials. Both were learned the hard way, one per shipped defect:
 *
 *   - The `interface` arm replaced a `wildcard: boolean` that folded "bound to
 *     `192.168.1.5`" in with "bound to `127.0.0.1`". They want opposite handling:
 *     both mechanisms dial the far side's loopback, so an interface bind is
 *     reachable at THAT address and by no door kolu can open.
 *   - `family` exists because the first cut of `scope` folded `127.0.0.1` and
 *     `::1` into one `loopback`, and BOTH mechanisms then dialled v4. A dev
 *     server on `[::1]:5173` got a tunnel that came up perfectly and served
 *     nothing — the door was open onto an address with no listener behind it.
 *
 *  Both defects have the same shape, which is why they are called out together:
 *  a fact the OS gave us was collapsed below what the consumer needed, and the
 *  collapse was invisible until something dialled the answer. */
export function addressBind(bytes: readonly number[]): {
  scope: PortScope;
  family: PortFamily;
} {
  // A v4-MAPPED address (`::ffff:a.b.c.d`) is judged as the v4 address it
  // carries, in BOTH answers: the socket is AF_INET6, but a v4 dial reaches it,
  // and the dial is what the family exists to decide.
  const mapped = mappedV4(bytes);
  const v4 = bytes.length === 4 ? bytes : mapped;
  if (v4 !== undefined) {
    // `0.0.0.0` / the mapped wildcard · the whole `127.0.0.0/8` (a resolver stub
    // on `127.0.0.53` is loopback too) · anything else is one real interface.
    const scope = v4.every((b) => b === 0)
      ? "any"
      : v4[0] === 127
        ? "loopback"
        : "interface";
    return { scope, family: "v4" };
  }
  if (bytes.length === 16) {
    if (bytes.every((b) => b === 0)) return { scope: "any", family: "v6" };
    const isV6Loopback =
      bytes.slice(0, 15).every((b) => b === 0) && bytes[15] === 1;
    return {
      scope: isV6Loopback ? "loopback" : "interface",
      family: "v6",
    };
  }
  // A width neither decoder produces. The decoders already refuse anything but
  // 4 or 16 bytes, so this is unreachable by construction — but it must answer
  // SOMETHING, and the safe answer is the one that offers no door.
  return { scope: "interface", family: "v6" };
}

/** A `/proc/net/tcp{,6}` LISTEN row, keyed by the socket inode the fd walk joins
 *  against. */
interface ProcListener extends Listener {
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
      "blind",
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
        "blind",
        `port scan: unreadable /proc/net/tcp row (${cols.length} columns): ${line.trim()}`,
      );
    }
    if (cols[3] !== TCP_LISTEN_STATE) continue;
    const local = cols[1]!;
    const split = local.lastIndexOf(":");
    if (split === -1) {
      throw new PortScanError(
        "blind",
        `port scan: "${local}" is not a /proc/net/tcp local_address (expected <hex>:<hex-port>)`,
      );
    }
    const port = Number.parseInt(local.slice(split + 1), 16);
    if (!TcpPortSchema.safeParse(port).success) {
      throw new PortScanError(
        "blind",
        `port scan: "${local}" carries no valid port in a /proc/net/tcp row`,
      );
    }
    listeners.push({
      port,
      ...addressBind(decodeProcAddress(local.slice(0, split))),
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
      "blind",
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
      "blind",
      `port scan: /proc/<pid>/stat had no pid/ppid pair: ${body.slice(0, 80)}`,
    );
  }
  return { pid, ppid, name };
}

/** Every numeric `/proc/<pid>` entry's `{pid, ppid, comm}`.
 *
 *  A pid that vanishes mid-read is dropped (the scan races exit constantly). An
 *  unreadable pid is dropped too UNLESS it is one of `roots` — a root we were
 *  asked about, where blindness must be loud rather than empty. */
async function linuxProcessTable(
  roots: ReadonlySet<number>,
): Promise<ProcessRow[]> {
  const entries = await readdir("/proc").catch((err: unknown) => {
    throw new PortScanError("blind", "port scan: /proc is unreadable", {
      cause: err,
    });
  });
  /** One pid's row, or `undefined` for a pid this pass may skip.
   *
   *  The SAME triad the fd walk uses (`procReadFailure`), not a looser one of its
   *  own. This catch used to `continue` on EVERY non-ENOENT errno for a non-root
   *  pid — so an unexpected `EIO`/`EMFILE` on an ordinary same-uid descendant
   *  silently dropped that row, disconnecting ITS descendants from the requested
   *  root and letting the pass publish a confidently PARTIAL answer. That is a
   *  caught error collapsing to missing state, which is the one thing this module
   *  is built not to do; only the exit race and the deliberate foreign-uid case
   *  are skippable.
   *
   *  The `try` wraps ONLY the read, not the parse below it: `parseProcStat` throws
   *  its own specific `PortScanError` (naming exactly which row/field was
   *  unreadable), and a parse failure has no errno, so folding it into this catch
   *  would route it through `procReadFailure(undefined, …)` and rethrow a generic
   *  "cannot read" message that buries the parser's real diagnostic in `.cause`. */
  const readRow = async (pid: string): Promise<ProcessRow | undefined> => {
    let raw: string;
    try {
      raw = await readFile(`/proc/${pid}/stat`, "utf8");
    } catch (err) {
      if (procReadFailure(errnoOf(err), roots.has(Number(pid))) === "skip") {
        return undefined;
      }
      throw new PortScanError(
        "blind",
        `port scan: cannot read /proc/${pid}/stat (${errnoOf(err)})`,
        { cause: err },
      );
    }
    return parseProcStat(raw);
  };

  // Read in BOUNDED batches rather than one strictly-serial await per pid. This is
  // the pass's dominant cost by an order of magnitude — it scales with the HOST's
  // process count, not with how many roots we were asked about — and each
  // `await` was one libuv threadpool round-trip with three of four threads idle.
  // Measured on a 511-process box: 30 ms serial → 11 ms batched.
  //
  // Bounded (not one `Promise.all` over everything) so a 10 000-process host does
  // not queue 10 000 threadpool items at once. Order is irrelevant to the result:
  // `partitionSubtrees` builds a children map, and `foldPorts` picks its name by
  // lexicographic minimum rather than by arrival.
  const pids = entries.filter((entry) => /^\d+$/.test(entry));
  const rows: ProcessRow[] = [];
  for (let i = 0; i < pids.length; i += PROC_READ_BATCH) {
    for (const row of await Promise.all(
      pids.slice(i, i + PROC_READ_BATCH).map(readRow),
    )) {
      if (row !== undefined) rows.push(row);
    }
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
 *  cmdline→comm order is the same one `socketHolder.ts` reaches for, but it is
 *  RE-DERIVED here, not shared — see {@link socketInodesOf}. */
async function linuxProcessName(
  pid: number,
  comm: string,
  log: Logger | undefined,
): Promise<string> {
  let cmdline: string;
  try {
    cmdline = await readFile(`/proc/${pid}/cmdline`, "utf8");
  } catch (err) {
    // A blanket `catch { return comm }` here swallowed EVERY failure into the
    // fallback — an `EIO`, an `EMFILE`, a permission change — and published the
    // fallback label as though it had been observed. Narrowed to the errnos that
    // MEAN "there is nothing to read": the exit race, and a pid that turned out
    // not to be ours.
    //
    // An unexpected errno still falls back rather than throwing, and that is
    // deliberate rather than lazy: `comm` is a REAL value this scan already read,
    // not a fabrication, and failing the whole subtree's port list over a
    // cosmetic label would trade a slightly-worse name for no ports at all. What
    // it must not be is SILENT, so it is logged.
    if (procReadFailure(errnoOf(err), false) !== "skip") {
      log?.warn(
        { err, pid },
        "port scan: unexpected /proc/<pid>/cmdline failure — labelling the port from `comm` instead",
      );
    }
    return comm;
  }
  // NUL-separated argv. An empty cmdline is a kernel thread, which cannot own a
  // TCP listener — but if one ever reaches here, `comm` is the honest answer.
  const argv0 = cmdline.split("\0")[0];
  return argv0 !== undefined && argv0 !== "" ? path.basename(argv0) : comm;
}

/** What to do when a `/proc/<pid>` read fails — the fd listing, the `stat` row,
 *  or a name lookup. ONE policy for all of them, as one pure decision, because
 *  getting it wrong is not a small mistake:
 *
 *   - **The exit race** (`ENOENT`/`ESRCH`) — the process is gone. Skip it; it
 *     holds nothing, which is the truth.
 *   - **A foreign-uid DESCENDANT** (`EACCES`/`EPERM`) — skip that pid. A
 *     setuid-root child is routine, not exotic: `sudo` sitting at its password
 *     prompt is root-owned with an unreadable `fd/` (measured), and so is any
 *     `su`/`pkexec`/setuid `ping`. Treating it as blindness took the WHOLE scan
 *     down — one `sudo nixos-rebuild` in one terminal emptied kolu's Ports section
 *     for **every** terminal on the host and logged an ERROR every 5 s until the
 *     prompt was answered. The header's own reasoning already tolerates "another
 *     user's, unreadable" pids; the oversight was assuming they only appear
 *     OUTSIDE a subtree.
 *   - **A requested ROOT pid** — throw. That pid is one the CALLER spawned, so it
 *     runs as the calling process's own uid; unreadable there means we genuinely
 *     cannot answer for that root, and "no ports" would be a lie shaped exactly
 *     like the truth.
 *
 *  The cost of skipping, stated: a listener held ONLY by a root-owned descendant
 *  is invisible. That is a real gap, and it is the better half of the trade —
 *  a `sudo` prompt holds no listening socket, while the alternative blinds every
 *  subtree on the box for as long as the prompt is open. */
export function procReadFailure(
  code: string | undefined,
  isRequestedRoot: boolean,
): "skip" | "throw" {
  if (code === "ENOENT" || code === "ESRCH") return "skip";
  if ((code === "EACCES" || code === "EPERM") && !isRequestedRoot)
    return "skip";
  return "throw";
}

/** The socket inodes a pid holds open, via the `/proc/<pid>/fd` readlink technique.
 *
 *  ⚠ RE-DERIVED, NOT SHARED. `@kolu/surface-daemon-supervisor`'s
 *  `socketHolder.ts` (`linuxSocketHolders`) walks `/proc/<pid>/fd` for
 *  `socket:[inode]` links too, and kolu's daemon runs both — so "how
 *  does this OS attribute a socket to a process" is encapsulated TWICE in this repo,
 *  and the next `/proc`/`lsof`/macOS change has two edit sites. The copies do NOT
 *  agree: that one blanket-`catch { continue }`s an unreadable `/proc/<pid>/fd` and
 *  collapses an unreadable `/proc` to `[]` (the very
 *  `caught-error-must-not-collapse-to-empty` shape {@link procReadFailure} exists to
 *  forbid), because its question is "who holds THIS socket path" rather than "what
 *  is this subtree serving". Extracting one leaf both plug into — with the
 *  fd-failure policy INJECTED so each keeps its own — is the real fix, and is a
 *  standing item rather than something this module can do alone.
 *
 *  Returns `undefined` when this pid cannot be inspected — an exited process, or
 *  a foreign-uid descendant. See {@link procReadFailure} for which failures are
 *  which, and why only a REQUESTED ROOT's unreadable `fd/` is fatal. */
async function socketInodesOf(
  pid: number,
  isRequestedRoot: boolean,
): Promise<Set<string> | undefined> {
  let fds: string[];
  try {
    fds = await readdir(`/proc/${pid}/fd`);
  } catch (err) {
    if (procReadFailure(errnoOf(err), isRequestedRoot) === "skip")
      return undefined;
    throw new PortScanError(
      "blind",
      `port scan: cannot list /proc/${pid}/fd for a requested root (${errnoOf(err)})`,
      { cause: err },
    );
  }
  // Concurrent, for the same reason the pid table is batched: the fd list is
  // already in hand and small, and a Node process inside a scanned subtree can hold
  // a couple of hundred descriptors. Measured over the 30 most fd-heavy pids on a
  // real box (1 823 readlinks): 33 ms serial → 18 ms concurrent.
  //
  // A throw inside `Promise.all` still rejects the pass, so the blindness policy is
  // unchanged — only the interleaving is.
  const inodes = new Set<string>();
  await Promise.all(
    fds.map(async (fd) => {
      let target: string;
      try {
        target = await readlink(`/proc/${pid}/fd/${fd}`);
      } catch (err) {
        // A descriptor closed between the readdir and the readlink — the same exit
        // race one level down. The permission arms ride the same policy as the
        // listing above: a process that turned setuid between the readdir and this
        // read is the descendant case arriving one level late, and it must not take
        // the host's whole scan with it.
        if (procReadFailure(errnoOf(err), isRequestedRoot) === "skip") return;
        throw new PortScanError(
          "blind",
          `port scan: cannot read /proc/${pid}/fd/${fd} (${errnoOf(err)})`,
          { cause: err },
        );
      }
      const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
      if (inode !== undefined) inodes.add(inode);
    }),
  );
  return inodes;
}

/** Read the whole linux host once: the pid table, the LISTEN rows indexed by
 *  socket inode, and the two per-pid reads the join asks for. */
async function readLinux(
  roots: ReadonlySet<number>,
  log: Logger | undefined,
): Promise<HostReading> {
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
  const comm = new Map(table.map((row) => [row.pid, row.name]));
  return {
    table,
    listenersOf: async (pid) => {
      const inodes = await socketInodesOf(pid, roots.has(pid));
      if (inodes === undefined) return undefined;
      return [...inodes]
        .map((inode) => listeners.get(inode))
        .filter((l): l is ProcListener => l !== undefined);
    },
    // The second read linux earns — and only for a pid the join has already found
    // to hold a listener, which is a handful rather than the whole table.
    nameOf: (pid) => linuxProcessName(pid, comm.get(pid) ?? String(pid), log),
  };
}

// ── darwin: one libproc pass ───────────────────────────────────────────

/** The stdout grammar version this parser understands. The helper prints its own
 *  version as the FIRST line and this refuses anything else — the one shape of
 *  skew that must never degrade quietly, because a helper whose fields moved would
 *  otherwise parse to zero listeners and read as "nothing here is serving
 *  anything". Bump both together or not at all. */
const HELPER_FORMAT_VERSION = 1;

/** A darwin listener, keyed by the pid libproc reports holding the socket. */
interface HelperListener extends Listener {
  pid: number;
}

/** Both tables the helper prints in one pass. */
export interface HelperReading {
  table: ProcessRow[];
  listeners: HelperListener[];
}

/** Parse `kolu-port-scan-darwin`'s output.
 *
 *  Tab-separated, tagged by the first field, version first:
 *
 *      V→1
 *      P→<pid>→<ppid>→<name>          the process table
 *      L→<pid>→<port>→<hex address>   one listening TCP socket
 *
 *  `<name>` is last because it may contain spaces (the helper strips tabs from it,
 *  so arity is fixed). The address is the RAW bind bytes as hex — 8 chars for v4,
 *  32 for v6 — decoded by {@link decodeProcAddress} and judged by
 *  {@link addressBind}, the SAME two functions the linux `/proc` reader uses. That
 *  is the point of moving hex rather than a tag across this boundary: one
 *  classifier, so the two platforms cannot come to disagree about
 *  `::ffff:0.0.0.0`.
 *
 *  Every unreadable line throws. A helper we cannot parse is a blind pass, and a
 *  blind pass must not look like an empty one. */
export function parseHelperOutput(body: string): HelperReading {
  const lines = body.split("\n");
  const first = lines[0] ?? "";
  const version = /^V\t(\d+)$/.exec(first);
  if (version === null) {
    throw new PortScanError(
      "blind",
      `port scan: helper did not begin with a version line (got ${JSON.stringify(first.slice(0, 40))})`,
    );
  }
  if (Number(version[1]) !== HELPER_FORMAT_VERSION) {
    throw new PortScanError(
      "blind",
      `port scan: helper speaks format ${version[1]}, this reader speaks ${HELPER_FORMAT_VERSION} — the baked helper and this build are from different sources`,
    );
  }

  const table: ProcessRow[] = [];
  const listeners: HelperListener[] = [];
  for (const line of lines.slice(1)) {
    if (line === "") continue;
    const f = line.split("\t");
    if (f[0] === "P") {
      // 4 fields exactly: the name is the last and cannot contain a tab.
      if (f.length !== 4) {
        throw new PortScanError(
          "blind",
          `port scan: unreadable helper process row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      const ppid = Number(f[2]);
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
        throw new PortScanError(
          "blind",
          `port scan: helper process row has a non-numeric pid: ${line}`,
        );
      }
      // The helper already sends the executable's BASENAME; `path.basename` here
      // would be a second opinion about a decision made there.
      table.push({ pid, ppid, name: f[3]! });
      continue;
    }
    if (f[0] === "L") {
      if (f.length !== 4) {
        throw new PortScanError(
          "blind",
          `port scan: unreadable helper listener row: ${line}`,
        );
      }
      const pid = Number(f[1]);
      const port = Number(f[2]);
      if (!Number.isInteger(pid)) {
        throw new PortScanError(
          "blind",
          `port scan: helper listener row has a non-numeric pid: ${line}`,
        );
      }
      if (!TcpPortSchema.safeParse(port).success) {
        throw new PortScanError(
          "blind",
          `port scan: helper listener row carries no valid port: ${line}`,
        );
      }
      listeners.push({
        port,
        ...addressBind(decodeNetworkAddress(f[3]!)),
        pid,
      });
      continue;
    }
    throw new PortScanError(
      "blind",
      `port scan: unknown helper row tag ${JSON.stringify(f[0] ?? "")}: ${line}`,
    );
  }
  return { table, listeners };
}

/** The baked path to the libproc helper — `./native`, built by the derivation
 *  there.
 *
 *  An ENV VAR rather than a resolved path because the binary is a Nix output: the
 *  consumer's build bakes `KOLU_PORT_SCAN_HELPER` onto whatever wrapper runs the
 *  scan (in kolu, `koluEnv` puts it on the padi and kolu wrappers AND the dev
 *  shell). Never resolved from `PATH` and with no fallback — a required value that
 *  is absent is a crash, per the repo's fail-fast rule; a `PATH` lookup would
 *  silently find some other program named the same.
 *
 *  Read lazily — at scan time rather than module load — so importing this module
 *  is harmless on a host that will never scan, and the linux path (which needs no
 *  helper) never demands one. */
function portScanHelperPath(): string {
  const v = process.env.KOLU_PORT_SCAN_HELPER;
  if (!v) {
    throw new PortScanError(
      "blind",
      "KOLU_PORT_SCAN_HELPER is not set — it must be baked to `@kolu/port-scan`'s `native` derivation output (run under the Nix wrapper that sets it, or `nix develop`). The darwin port scan has no PATH fallback by design.",
    );
  }
  return v;
}

/** Read the whole darwin host once, through the libproc helper.
 *
 *  ONE fork/exec for both tables, where this used to be two (`ps` and `lsof`) plus
 *  two text formats. The helper asks libproc — the same source `ps` and `lsof`
 *  themselves read — so nothing is lost by not shelling out to them; see
 *  `packages/port-scan/native/portScanDarwin.c` for the syscall-level detail and for
 *  the non-root visibility caveat (own-uid pids only, which is sufficient because
 *  a scanned subtree runs as the calling process's own uid by construction). */
async function readDarwin(): Promise<HostReading> {
  const helper = portScanHelperPath();
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(helper, [], {
      timeout: PORT_SCAN_COMMAND_TIMEOUT_MS,
      // SIGKILL, not execFile's default SIGTERM. The timer exists for a helper
      // that is WEDGED in uninterruptible I/O, and that is precisely the process
      // entitled to ignore SIGTERM — a polite signal would make the timeout
      // advisory and leave the sampler's single-flight slot held forever.
      killSignal: "SIGKILL",
      // A 1000-process box prints ~60 KB; this is headroom. A genuine overflow
      // must fail rather than truncate into a short port list.
      maxBuffer: 8 * 1024 * 1024,
    }));
  } catch (err) {
    throw new PortScanError(
      "blind",
      `port scan: \`${helper}\` failed (${errnoOf(err) ?? "non-zero exit"})`,
      { cause: err },
    );
  }

  const { table, listeners } = parseHelperOutput(stdout);
  const name = new Map(table.map((row) => [row.pid, row.name]));
  const byPid = new Map<number, HelperListener[]>();
  for (const l of listeners) {
    const held = byPid.get(l.pid);
    if (held === undefined) byPid.set(l.pid, [l]);
    else held.push(l);
  }
  return {
    table,
    // The helper already reported WHICH pid holds each listener, so there is no
    // per-pid read to attempt and no failure to classify: a pid it could not
    // inspect simply has no rows. (`procReadFailure`'s policy is linux's fd-walk
    // policy; darwin does no fd walk from this process.)
    listenersOf: (pid) => Promise.resolve(byPid.get(pid) ?? []),
    // Already the executable's basename, decided in the helper — darwin needs no
    // second read to earn what linux reads `cmdline` for.
    nameOf: (pid) => Promise.resolve(name.get(pid) ?? String(pid)),
  };
}

// ── The one entry point ────────────────────────────────────────────────

/** Can this host be scanned AT ALL? A deployment fact, knowable before any pid is
 *  requested — which is exactly why it is separate from a scan.
 *
 *  `scanSubtreePorts` refuses an unsupported platform, but a per-pass refusal
 *  cannot be a caller's permanent-stop signal: a sampler whose first read happens
 *  to have no roots yet answers `new Map()` without ever reaching the platform
 *  switch, so the refusal arrives on some later tick — where a poll loop logs and
 *  holds rather than stopping, and the "said once, then stop" contract silently
 *  becomes an error every 5 s forever. Asking THIS first makes the check
 *  independent of whether any root exists. */
export function portScanSupported(): boolean {
  return process.platform === "linux" || process.platform === "darwin";
}

/** Scan the host once and return the listening ports of each requested ROOT PID's
 *  process subtree, sorted and deduplicated. Every requested pid is present in the
 *  result (with an empty array when its subtree serves nothing), so a caller can
 *  publish the whole set without asking which were covered.
 *
 *  Keyed by PID, and that is the boundary this package is drawn on. Everything in
 *  this module is OS vocabulary — pid tables, socket inodes, errno policy — and a
 *  caller's own identity (kolu passes terminal ids; the standalone tool will pass
 *  none) would be that domain threaded through a module that reads nothing and
 *  means nothing by it. The pid → caller-identity join belongs to the caller,
 *  which also makes two consumers rooted at the same pid ONE walk instead of two.
 *
 *  `log` is optional per `@kolu/log`'s own guidance for a package with no logger
 *  of its own to plumb: it is used for exactly one condition — an unexpected
 *  `/proc` errno while reading a port's LABEL, which falls back to a real-but-worse
 *  name and must not do so silently. A consumer that passes nothing loses that one
 *  line and nothing else; no scan RESULT depends on it.
 *
 *  Throws `PortScanError` — `"blind"` for a pass that could not see, and
 *  `"unsupported-platform"` for a host that never can, which the caller must NOT
 *  retry. Fail fast on the latter rather than answering an empty map: a third
 *  platform needs a real reader, and "no ports" is the one answer this package may
 *  never invent. */
export async function scanSubtreePorts(
  rootPids: readonly number[],
  opts: { log?: Logger } = {},
): Promise<Map<number, PortInfo[]>> {
  // `async` so EVERY failure arrives through one channel. Non-async, the two real
  // arms rejected while the unsupported-platform arm threw synchronously — so the
  // natural shape for a background sampler, `void scan(t).catch(log)`, handled a
  // blind /proc and a helper timeout but blew up uncaught on exactly the arm the
  // doc advertises as fail-fast.
  if (rootPids.length === 0) return new Map();
  switch (process.platform) {
    case "linux":
      return joinSubtreePorts(
        await readLinux(new Set(rootPids), opts.log),
        rootPids,
      );
    case "darwin":
      return joinSubtreePorts(await readDarwin(), rootPids);
    default:
      throw new PortScanError(
        "unsupported-platform",
        `port scan: unsupported platform '${process.platform}' — this reader supports linux and darwin only`,
      );
  }
}
