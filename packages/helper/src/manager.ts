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
import { createRequire } from "node:module";
import type {
  HelperDataEvent,
  HelperExitEvent,
  HelperPtyEvent,
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
}

export interface Manager {
  spawn(opts: {
    shell: string;
    args: string[];
    cwd: string;
    cols: number;
    rows: number;
    env: Record<string, string>;
  }): { ptyId: string; pid: number };
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
export function createManager(emit: (event: HelperPtyEvent) => void): Manager {
  const ptys = new Map<string, PtyEntry>();

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
  }): { ptyId: string; pid: number } {
    const ptyId = randomUUID();
    const proc = ptyLib.spawn(opts.shell, opts.args, {
      name: "xterm-256color",
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: opts.env,
    });

    const entry: PtyEntry = {
      ptyId,
      pid: proc.pid,
      proc,
      lastSeq: 0,
      buffer: [],
      exited: false,
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

  function shutdown(): void {
    for (const entry of ptys.values()) {
      if (!entry.exited) {
        try {
          entry.proc.kill();
        } catch {
          // Best-effort during shutdown.
        }
      }
    }
    ptys.clear();
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
    shutdown,
  };
}
