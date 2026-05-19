/**
 * PTY manager for the remote helper.
 *
 * Owns the map of `ptyId → PTY` and the per-PTY ring buffer of emitted
 * events. The buffer is what makes `attach(sinceSeq)` work: the controller
 * remembers the last sequence it received, and on reconnect/restart of
 * the kolu side, the helper replays events whose `seq > sinceSeq`.
 *
 * Detach (controller goes away, but PTY is meant to keep running) is the
 * default state: the PTY runs, output piles into the ring buffer, and on
 * the next attach the controller catches up.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  HelperDataEvent,
  HelperExitEvent,
  HelperForegroundChangeEvent,
  HelperPtyEvent,
  HelperWatchEvent,
} from "kolu-common/helper-protocol";
import { localExecutor, type WatchHandle } from "kolu-git/executor";

/** Helper-side foreground-poll cadence. Local to the helper process —
 *  no SSH round trip — so we can poll cheaply. 200 ms is faster than
 *  the old controller-side 250 ms poll but emits to the controller only
 *  on actual change, so the SSH channel sees at most a small handful of
 *  frames per PTY across an entire session (one per agent start/exit). */
const FOREGROUND_POLL_MS = 200;

const require = createRequire(import.meta.url);
// node-pty has no ESM build; load via createRequire so TypeScript is happy
// and the import shape works in both `tsx` (dev) and bundled prod runs.
// biome-ignore lint/suspicious/noExplicitAny: node-pty types are dynamic
const ptyLib = require("node-pty") as any;

/** Per-PTY ring buffer cap **in bytes** (not events). PTY output is
 *  bursty — a single `cat` of a large file can produce hundreds of small
 *  data events in milliseconds — so an event-count cap silently shed
 *  whole megabytes of scrollback during a flood while a byte cap keeps
 *  the buffer tracking what the user actually sees.
 *
 *  4 MiB comfortably covers a typical scrollback plus a sane reconnect
 *  gap. On the wire it sits in the helper's memory, not on disk, and
 *  one PTY pinning 4 MiB even at the worst case is cheap. */
const RING_BUFFER_MAX_BYTES = 4 * 1024 * 1024;

interface PtyEntry {
  ptyId: string;
  pid: number;
  proc: {
    write(data: string): void;
    resize(c: number, r: number): void;
    kill(): void;
    readonly process: string;
  };
  /** Monotonically increasing sequence number for events this PTY has emitted. */
  lastSeq: number;
  /** Lowest sequence number still in `buffer` (i.e. the seq of `buffer[0]`).
   *  Used by `replay` to detect a gap: if `sinceSeq < oldestSeq - 1`,
   *  the buffer evicted events the controller hadn't seen yet. */
  oldestSeq: number;
  /** Most recent events, oldest first. Total `data` byte size is capped
   *  at `RING_BUFFER_MAX_BYTES`; oldest events are shifted out when the
   *  cap is exceeded. */
  buffer: HelperPtyEvent[];
  /** Sum of byte sizes of every `data` event currently in `buffer`. The
   *  shift-when-over-cap loop reads this; non-data events (`exit`) add
   *  zero. */
  bufferBytes: number;
  /** True once an exit event has been pushed — write/resize become no-ops. */
  exited: boolean;
  /** Path to the per-pty rcfile, if `rcContent` was sent on spawn.
   *  Removed on dispose to avoid leaking files in `~/.kolu-helper/`. */
  rcFilePath?: string;
}

/** Directory the helper writes per-pty rcfiles into. Sits in `$HOME` so
 *  it survives across SSH sessions for any cleanup-after-crash logic
 *  we add later, and so the rc files can be `--rcfile`-sourced by a
 *  bash that the spawned user actually has read access to. */
const HELPER_DIR = join(homedir(), ".kolu-helper");

export interface Manager {
  spawn(opts: {
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
    rcContent?: string;
  }): { ptyId: string; pid: number };
  exec(opts: {
    cmd: string;
    args: string[];
    cwd?: string;
    timeoutMs?: number;
    maxBytes?: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number | null }>;
  watch(opts: {
    path: string;
    recursive?: boolean;
  }): Promise<{ subId: string }>;
  unwatch(subId: string): void;
  queryDb(opts: {
    path: string;
    sql: string;
    params?: ReadonlyArray<string | number | null>;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  readFile(opts: {
    path: string;
    maxBytes?: number;
  }): Promise<{ content: string; truncated: boolean }>;
  statMtimeMs(path: string): Promise<number>;
  write(ptyId: string, data: string): void;
  resize(ptyId: string, cols: number, rows: number): void;
  dispose(ptyId: string): void;
  /** Replay buffered events strictly after `sinceSeq`. If sinceSeq is
   *  undefined, replays everything in the buffer. The `gap` flag is true
   *  when the buffer evicted events the controller hadn't yet acknowledged
   *  — the controller treats that as "scrollback is unrecoverable; reset
   *  screen state and let the live stream rebuild it." Reviewer #7. */
  replay(
    ptyId: string,
    sinceSeq: number | undefined,
  ): { events: HelperPtyEvent[]; gap: boolean };
  foregroundPid(ptyId: string): number | undefined;
  processName(ptyId: string): string | undefined;
  /** Start pushing `foregroundChange` events for this PTY whenever the
   *  foreground pid or process name actually differs from the last
   *  push. Emits an initial event immediately so the controller's
   *  cached value populates without a separate sync RPC. */
  subscribeForeground(ptyId: string): void;
  unsubscribeForeground(ptyId: string): void;
  list(): Array<{ ptyId: string; pid: number; lastSeq: number }>;
  /** Cleanup hook for shutdown — kills every PTY, no events emitted. */
  shutdown(): void;
}

/** Construct a Manager that emits events via `emit`. The emitter is
 *  intentionally external so the same Manager works under tests (stub
 *  emitter) and in production (stdout writer). */
export function createManager(
  emit: (
    event: HelperPtyEvent | HelperWatchEvent | HelperForegroundChangeEvent,
  ) => void,
): Manager {
  const ptys = new Map<string, PtyEntry>();
  const watchers = new Map<string, WatchHandle>();
  /** Per-PTY foreground subscription state. The timer polls locally and
   *  pushes only when `{pid, name}` differs from the last push. */
  interface ForegroundSub {
    timer: ReturnType<typeof setInterval>;
    lastPid: number | null;
    lastName: string | null;
  }
  const fgSubs = new Map<string, ForegroundSub>();

  function record(ptyId: string, build: (seq: number) => HelperPtyEvent): void {
    const entry = ptys.get(ptyId);
    if (!entry) return;
    entry.lastSeq += 1;
    const event = build(entry.lastSeq);
    entry.buffer.push(event);
    if (event.method === "data") entry.bufferBytes += event.params.data.length;
    // Shift oldest events out until we're back under the byte cap.
    // `oldestSeq` advances with each eviction so `replay()` can detect
    // a gap by comparing it against the controller's `sinceSeq + 1`.
    while (
      entry.bufferBytes > RING_BUFFER_MAX_BYTES &&
      entry.buffer.length > 1
    ) {
      const dropped = entry.buffer.shift();
      if (dropped?.method === "data") {
        entry.bufferBytes -= dropped.params.data.length;
      }
      if (dropped) entry.oldestSeq = dropped.params.seq + 1;
    }
    emit(event);
  }

  function spawn(opts: {
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
    rcContent?: string;
  }): { ptyId: string; pid: number } {
    const ptyId = randomUUID();
    // Inherit the helper's own process.env (PATH, HOME, USER, etc. as
    // configured by the remote login shell that started the helper),
    // then layer the controller's overlay on top. Without this, kolu's
    // LOCAL nix-store PATH would be sent through and the spawned bash
    // would have no working binaries on the remote.
    const env = { ...process.env, ...opts.env } as Record<string, string>;
    // Empty `shell` ⇒ use the helper user's login shell ($SHELL), or
    // fall back to /bin/sh. The controller can't know the remote
    // user's shell choice; on NixOS, `/bin/bash` doesn't even exist
    // (only `/bin/sh`), so a hardcoded "/bin/bash" from the controller
    // would `execvp` fail. node-pty's spawn calls execvp(shell), which
    // returns ENOENT and the PTY dies immediately with exitCode=1.
    const shell = opts.shell || env.SHELL || "/bin/sh";
    // Empty cwd ⇒ start in the helper user's HOME. node-pty interprets
    // "" as the literal empty path and fails; substituting HOME matches
    // what the user would get if they `ssh <host>` interactively.
    const cwd = opts.cwd || env.HOME || "/";
    // Wrapper rc — bash-only for the prototype. Write the controller's
    // rc content to a per-pty file and prepend `--rcfile <path>` to
    // args so the spawned bash sources our OSC-injection layer instead
    // of the user's ~/.bashrc directly (our rc replays the user
    // dotfiles AND adds OSC hooks; otherwise `cd` events never reach
    // kolu).
    let rcFilePath: string | undefined;
    let args = opts.args;
    if (opts.rcContent !== undefined) {
      try {
        mkdirSync(HELPER_DIR, { recursive: true });
      } catch {
        // Best-effort — if mkdir fails the writeFileSync below will too
        // and we'll surface the error to the controller.
      }
      rcFilePath = join(HELPER_DIR, `bashrc-${ptyId}`);
      writeFileSync(rcFilePath, opts.rcContent);
      // `--rcfile` is bash-specific. The spawned shell must be bash for
      // this to take effect; on other shells the flag is ignored or
      // errors. Bash-only-on-remote is the documented v0 limitation.
      args = ["--rcfile", rcFilePath, ...opts.args];
    }
    const proc = ptyLib.spawn(shell, args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env,
    });

    const entry: PtyEntry = {
      ptyId,
      pid: proc.pid,
      proc,
      lastSeq: 0,
      oldestSeq: 1,
      buffer: [],
      bufferBytes: 0,
      exited: false,
      rcFilePath,
    };
    ptys.set(ptyId, entry);

    proc.onData((data: string) => {
      if (entry.exited) return;
      const event: HelperDataEvent = {
        method: "data",
        params: { ptyId, seq: 0, data },
      };
      record(ptyId, (seq) => ({ ...event, params: { ...event.params, seq } }));
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      if (entry.exited) return;
      entry.exited = true;
      const event: HelperExitEvent = {
        method: "exit",
        params: { ptyId, seq: 0, exitCode },
      };
      record(ptyId, (seq) => ({ ...event, params: { ...event.params, seq } }));
    });

    return { ptyId, pid: proc.pid };
  }

  function write(ptyId: string, data: string): void {
    const entry = ptys.get(ptyId);
    if (!entry || entry.exited) return;
    entry.proc.write(data);
  }

  function resize(ptyId: string, cols: number, rows: number): void {
    const entry = ptys.get(ptyId);
    if (!entry || entry.exited) return;
    entry.proc.resize(cols, rows);
  }

  function dispose(ptyId: string): void {
    const entry = ptys.get(ptyId);
    if (!entry) return;
    if (!entry.exited) {
      try {
        entry.proc.kill();
      } catch {
        // Ignore — process may have already exited.
      }
    }
    if (entry.rcFilePath) {
      try {
        rmSync(entry.rcFilePath, { force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
    unsubscribeForeground(ptyId);
    ptys.delete(ptyId);
  }

  function replay(
    ptyId: string,
    sinceSeq: number | undefined,
  ): { events: HelperPtyEvent[]; gap: boolean } {
    const entry = ptys.get(ptyId);
    if (!entry) return { events: [], gap: false };
    if (sinceSeq === undefined) {
      return { events: [...entry.buffer], gap: false };
    }
    // Gap detection: the controller wants events strictly after
    // `sinceSeq`. If the next event we have is `sinceSeq + 2` or later
    // (or we have no events at all but `lastSeq > sinceSeq`), we've
    // evicted output the controller never observed — the data between
    // sinceSeq and the buffer's start is gone forever. Signal the gap
    // so the controller can clear xterm scrollback and resync from the
    // live stream.
    const expectedNext = sinceSeq + 1;
    const earliestBuffered =
      entry.buffer.length > 0 ? entry.buffer[0]!.params.seq : entry.lastSeq + 1;
    const gap = earliestBuffered > expectedNext;
    const events = entry.buffer.filter((e) => e.params.seq > sinceSeq);
    return { events, gap };
  }

  function foregroundPid(ptyId: string): number | undefined {
    const entry = ptys.get(ptyId);
    if (!entry) return undefined;
    const pid = (entry.proc as unknown as { foregroundPid?: number })
      .foregroundPid;
    return pid && pid > 0 ? pid : undefined;
  }

  function processName(ptyId: string): string | undefined {
    const entry = ptys.get(ptyId);
    if (!entry) return undefined;
    try {
      return entry.proc.process || undefined;
    } catch {
      return undefined;
    }
  }

  function emitForeground(ptyId: string, sub: ForegroundSub): void {
    const pid = foregroundPid(ptyId) ?? null;
    const name = processName(ptyId) ?? null;
    if (pid === sub.lastPid && name === sub.lastName) return;
    sub.lastPid = pid;
    sub.lastName = name;
    emit({
      method: "foregroundChange",
      params: { ptyId, pid, name },
    });
  }

  function subscribeForeground(ptyId: string): void {
    if (fgSubs.has(ptyId)) return;
    // Sentinels chosen so the first poll always differs and emits an
    // initial frame to populate the controller's cache without a
    // separate sync RPC.
    const sub: ForegroundSub = {
      timer: setInterval(() => emitForeground(ptyId, sub), FOREGROUND_POLL_MS),
      lastPid: Number.NaN as unknown as number,
      lastName: "\0",
    };
    fgSubs.set(ptyId, sub);
    // Fire once synchronously so the controller doesn't wait FOREGROUND_POLL_MS
    // for the first datum.
    emitForeground(ptyId, sub);
  }

  function unsubscribeForeground(ptyId: string): void {
    const sub = fgSubs.get(ptyId);
    if (!sub) return;
    clearInterval(sub.timer);
    fgSubs.delete(ptyId);
  }

  function list(): Array<{ ptyId: string; pid: number; lastSeq: number }> {
    return Array.from(ptys.values()).map((e) => ({
      ptyId: e.ptyId,
      pid: e.pid,
      lastSeq: e.lastSeq,
    }));
  }

  // exec/readFile/statMtimeMs/watch are all delegations to kolu-git's
  // `localExecutor` — the helper is the remote-end shim for exactly that
  // primitive set. Reimplementing them here would be straight duplication.
  // queryDb stays helper-specific (kolu-git has no SQLite need).
  function exec(opts: {
    cmd: string;
    args: string[];
    cwd?: string;
    timeoutMs?: number;
    maxBytes?: number;
  }) {
    return localExecutor.exec(opts.cmd, opts.args, {
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      maxBytes: opts.maxBytes,
    });
  }
  function readFile(opts: { path: string; maxBytes?: number }) {
    return localExecutor.readFile(opts.path, { maxBytes: opts.maxBytes });
  }
  function statMtimeMs(path: string) {
    return localExecutor.statMtimeMs(path);
  }

  async function startWatch(opts: {
    path: string;
    recursive?: boolean;
  }): Promise<{
    subId: string;
  }> {
    const subId = randomUUID();
    const handle = await localExecutor.watch(
      opts.path,
      (rel) => {
        emit({
          method: "watchEvent",
          params: { subId, path: rel },
        });
      },
      { recursive: opts.recursive ?? false },
    );
    watchers.set(subId, handle);
    return { subId };
  }

  function stopWatch(subId: string): void {
    const handle = watchers.get(subId);
    if (!handle) return;
    handle.stop();
    watchers.delete(subId);
  }

  async function queryDb(opts: {
    path: string;
    sql: string;
    params?: ReadonlyArray<string | number | null>;
  }): Promise<{ rows: Array<Record<string, unknown>> }> {
    // Delegate to localExecutor — the helper's queryDb is identical to
    // the controller's localExecutor.queryDb (both wrap node:sqlite the
    // same way). One source of truth.
    if (!localExecutor.queryDb) {
      throw new Error("queryDb not supported by localExecutor");
    }
    const rows = await localExecutor.queryDb(opts.path, opts.sql, opts.params);
    return { rows };
  }

  function shutdown(): void {
    for (const entry of ptys.values()) {
      if (!entry.exited) {
        try {
          entry.proc.kill();
        } catch {
          // Best-effort during shutdown.
        }
      }
      if (entry.rcFilePath) {
        try {
          rmSync(entry.rcFilePath, { force: true });
        } catch {
          // Best-effort during shutdown.
        }
      }
    }
    ptys.clear();
    for (const handle of watchers.values()) handle.stop();
    watchers.clear();
    for (const sub of fgSubs.values()) clearInterval(sub.timer);
    fgSubs.clear();
  }

  return {
    spawn,
    write,
    resize,
    dispose,
    replay,
    foregroundPid,
    processName,
    subscribeForeground,
    unsubscribeForeground,
    list,
    exec,
    watch: startWatch,
    unwatch: stopWatch,
    queryDb,
    readFile,
    statMtimeMs,
    shutdown,
  };
}
