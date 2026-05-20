/**
 * Executor — side-effecting IO primitives shared by Kolu integrations.
 *
 * Callers default to `localExecutor` today. Future host implementations can
 * satisfy this same shape for remote filesystems/processes without changing
 * integration logic.
 */

import { execFile } from "node:child_process";
import { watch as fsWatch } from "node:fs";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import { promisify } from "node:util";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface WatchHandle {
  stop(): void;
}

export interface Executor {
  exec(
    cmd: string,
    args: string[],
    opts?: {
      cwd?: string;
      timeoutMs?: number;
      maxBytes?: number;
    },
  ): Promise<ExecResult>;
  readFile(
    path: string,
    opts?: { maxBytes?: number },
  ): Promise<{ content: string; truncated: boolean }>;
  statMtimeMs(path: string): Promise<number>;
  watch(
    path: string,
    onChange: (relPath: string) => void,
    opts?: { recursive?: boolean },
  ): Promise<WatchHandle>;
  queryDb?(
    path: string,
    sql: string,
    params?: ReadonlyArray<string | number | null>,
  ): Promise<Array<Record<string, unknown>>>;
}

const execFileP = promisify(execFile);

export const localExecutor: Executor = {
  exec: async (cmd, args, opts) =>
    new Promise((resolve) => {
      execFileP(cmd, args, {
        cwd: opts?.cwd,
        timeout: opts?.timeoutMs ?? 30_000,
        maxBuffer: opts?.maxBytes ?? 128 * 1024 * 1024,
      })
        .then(({ stdout, stderr }) =>
          resolve({
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            exitCode: 0,
          }),
        )
        .catch(
          (
            err: NodeJS.ErrnoException & {
              stdout?: unknown;
              stderr?: unknown;
              code?: number | string;
            },
          ) => {
            resolve({
              stdout: String(err.stdout ?? ""),
              stderr: String(err.stderr ?? ""),
              exitCode: typeof err.code === "number" ? err.code : null,
            });
          },
        );
    }),
  readFile: async (path, opts) => {
    const max = opts?.maxBytes ?? 1_048_576;
    const buf = await fsReadFile(path);
    if (buf.length > max) {
      return {
        content: buf.subarray(0, max).toString("utf-8"),
        truncated: true,
      };
    }
    return { content: buf.toString("utf-8"), truncated: false };
  },
  statMtimeMs: async (path) => {
    const s = await fsStat(path);
    return s.mtimeMs;
  },
  watch: async (path, onChange, opts) => {
    const watcher = fsWatch(
      path,
      { recursive: opts?.recursive ?? false, persistent: true },
      (_eventType, filename) => onChange(filename ? filename.toString() : ""),
    );
    return {
      stop: () => {
        try {
          watcher.close();
        } catch {
          // Already closed.
        }
      },
    };
  },
  queryDb: async (path, sql, params) => {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(path, { readOnly: true });
    try {
      const stmt = db.prepare(sql);
      return stmt.all(...(params ?? [])) as Array<Record<string, unknown>>;
    } finally {
      db.close();
    }
  },
};
