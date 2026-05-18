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

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  type FSWatcher,
  mkdirSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  HelperDataEvent,
  HelperExitEvent,
  HelperPtyEvent,
  HelperWatchEvent,
} from "kolu-common/helper-protocol";

const require = createRequire(import.meta.url);
// node-pty has no ESM build; load via createRequire so TypeScript is happy
// and the import shape works in both `tsx` (dev) and bundled prod runs.
// biome-ignore lint/suspicious/noExplicitAny: node-pty types are dynamic
const ptyLib = require("node-pty") as any;

/** Ring buffer size per PTY (events, not bytes). Tuned for typical
 *  scrollback-plus-burst: enough to hold a normal terminal session of
 *  output across a brief reconnect, small enough that an idle remote
 *  helper doesn't accumulate megabytes per PTY. */
const RING_BUFFER_SIZE = 4096;

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
  /** Most recent events, oldest first. Length capped at RING_BUFFER_SIZE. */
  buffer: HelperPtyEvent[];
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
  watch(opts: { path: string; recursive?: boolean }): { subId: string };
  unwatch(subId: string): void;
  queryDb(opts: {
    path: string;
    sql: string;
    params?: ReadonlyArray<string | number | null>;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  write(ptyId: string, data: string): void;
  resize(ptyId: string, cols: number, rows: number): void;
  dispose(ptyId: string): void;
  /** Replay buffered events strictly after `sinceSeq`. If sinceSeq is
   *  undefined, replays everything in the buffer. */
  replay(ptyId: string, sinceSeq: number | undefined): HelperPtyEvent[];
  foregroundPid(ptyId: string): number | undefined;
  processName(ptyId: string): string | undefined;
  list(): Array<{ ptyId: string; pid: number; lastSeq: number }>;
  /** Cleanup hook for shutdown — kills every PTY, no events emitted. */
  shutdown(): void;
}

/** Construct a Manager that emits events via `emit`. The emitter is
 *  intentionally external so the same Manager works under tests (stub
 *  emitter) and in production (stdout writer). */
export function createManager(
  emit: (event: HelperPtyEvent | HelperWatchEvent) => void,
): Manager {
  const ptys = new Map<string, PtyEntry>();
  const watchers = new Map<string, FSWatcher>();

  function record(ptyId: string, build: (seq: number) => HelperPtyEvent): void {
    const entry = ptys.get(ptyId);
    if (!entry) return;
    entry.lastSeq += 1;
    const event = build(entry.lastSeq);
    entry.buffer.push(event);
    if (entry.buffer.length > RING_BUFFER_SIZE) {
      entry.buffer.splice(0, entry.buffer.length - RING_BUFFER_SIZE);
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
      buffer: [],
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
    ptys.delete(ptyId);
  }

  function replay(
    ptyId: string,
    sinceSeq: number | undefined,
  ): HelperPtyEvent[] {
    const entry = ptys.get(ptyId);
    if (!entry) return [];
    if (sinceSeq === undefined) return [...entry.buffer];
    return entry.buffer.filter((e) => e.params.seq > sinceSeq);
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

  function list(): Array<{ ptyId: string; pid: number; lastSeq: number }> {
    return Array.from(ptys.values()).map((e) => ({
      ptyId: e.ptyId,
      pid: e.pid,
      lastSeq: e.lastSeq,
    }));
  }

  function exec(opts: {
    cmd: string;
    args: string[];
    cwd?: string;
    timeoutMs?: number;
    maxBytes?: number;
  }): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const maxBytes = opts.maxBytes ?? 1_048_576;
    return new Promise((resolve) => {
      execFile(
        opts.cmd,
        opts.args,
        {
          cwd: opts.cwd,
          timeout: timeoutMs,
          maxBuffer: maxBytes,
          env: process.env,
        },
        (err, stdout, stderr) => {
          // execFile rejects on non-zero exit; we want the exit code
          // delivered to the controller in either case so kolu-git can
          // distinguish "git found nothing" (exitCode 128) from "git
          // not on PATH" (spawn-failed).
          const exitCode =
            err && "code" in err && typeof err.code === "number"
              ? err.code
              : err
                ? null
                : 0;
          resolve({
            // execFile's `stdout`/`stderr` are typed as `string` when no
            // `encoding: "buffer"` is requested; the callback signature
            // narrowing isn't perfect across @types/node versions, so
            // accept either shape defensively.
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            exitCode,
          });
        },
      );
    });
  }

  function startWatch(opts: { path: string; recursive?: boolean }): {
    subId: string;
  } {
    const subId = randomUUID();
    // fs.watch's recursive option works on Linux 22+ and macOS; on
    // older kernels it silently degrades to non-recursive. Acceptable
    // for the prototype.
    const watcher = watch(
      opts.path,
      { recursive: opts.recursive ?? false, persistent: true },
      (_eventType, filename) => {
        emit({
          method: "watchEvent",
          params: { subId, path: filename ? filename.toString() : "" },
        });
      },
    );
    watcher.on("error", () => {
      // fs.watch errors (e.g. removed dir) tear down the subscription
      // silently — the consumer's setCwd will install a fresh watch
      // when the next git operation resolves a valid repoRoot.
      watchers.delete(subId);
    });
    watchers.set(subId, watcher);
    return { subId };
  }

  function stopWatch(subId: string): void {
    const watcher = watchers.get(subId);
    if (!watcher) return;
    try {
      watcher.close();
    } catch {
      // ignore
    }
    watchers.delete(subId);
  }

  async function queryDb(opts: {
    path: string;
    sql: string;
    params?: ReadonlyArray<string | number | null>;
  }): Promise<{ rows: Array<Record<string, unknown>> }> {
    // node:sqlite is "experimental" but stable across the 22.x range
    // kolu's helper runs under (its derivation pins nodejs >= 22).
    // Read-only + WAL means we can poll a live OpenCode / Codex DB
    // while the agent process is writing it without blocking either
    // side.
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(opts.path, { readOnly: true });
    try {
      const stmt = db.prepare(opts.sql);
      const rows = stmt.all(...(opts.params ?? [])) as Array<
        Record<string, unknown>
      >;
      return { rows };
    } finally {
      db.close();
    }
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
    for (const watcher of watchers.values()) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    watchers.clear();
  }

  return {
    spawn,
    write,
    resize,
    dispose,
    replay,
    foregroundPid,
    processName,
    list,
    exec,
    watch: startWatch,
    unwatch: stopWatch,
    queryDb,
    shutdown,
  };
}
