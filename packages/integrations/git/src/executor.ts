/**
 * `GitExecutor` — the side-effecting primitives kolu-git needs from its
 * environment. By taking these as a parameter (rather than reaching for
 * `child_process` / `fs` directly), every kolu-git operation works
 * unchanged against:
 *
 *   - the controller's local filesystem (`localExecutor`, the default
 *     when callers pass nothing), and
 *
 *   - any other host that satisfies this shape — including kolu-server's
 *     `Host` interface, which routes the same primitives through the SSH
 *     helper. That's how Code-tab / branch chip / repo watching all
 *     light up for remote terminals.
 *
 * No duplication. One module, two backends.
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

/** Side-effecting primitives kolu-git operations need.
 *  - `exec` runs a process and captures output.
 *  - `readFile` reads a UTF-8 file with a maxBytes guard.
 *  - `statMtimeMs` returns mtime in ms for cache-bust URLs.
 *  - `watch` subscribes to filesystem change events.
 */
export interface GitExecutor {
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
}

const execFileP = promisify(execFile);

/** Default `GitExecutor` — uses `child_process.execFile`, `fs.readFile`,
 *  `fs.stat`, `fs.watch` directly. Every kolu-git function defaults to
 *  this when no explicit executor is passed, so the local code path is
 *  unchanged from before the refactor (and so tests calling
 *  `getStatus(repoPath, "local")` keep working). */
export const localExecutor: GitExecutor = {
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
            // execFile rejects on non-zero exit. Preserve stdout/stderr
            // and pass the exit code through as a number when possible —
            // git uses non-zero exits for "expected" outcomes (e.g.
            // `git diff --no-index` returns 1 when files differ).
            const exitCode = typeof err.code === "number" ? err.code : null;
            resolve({
              stdout: String(err.stdout ?? ""),
              stderr: String(err.stderr ?? ""),
              exitCode,
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
    const w = fsWatch(
      path,
      { recursive: opts?.recursive ?? false, persistent: true },
      (_eventType, filename) => onChange(filename ? filename.toString() : ""),
    );
    return {
      stop: () => {
        try {
          w.close();
        } catch {
          // ignore
        }
      },
    };
  },
};
