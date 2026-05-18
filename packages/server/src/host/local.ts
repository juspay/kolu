/**
 * `LocalHost` — the default Host implementation. Wraps the existing
 * `spawnPty` (which uses `node-pty` directly) so the rest of the server
 * can treat local and remote terminals uniformly. No new process,
 * no SSH, no marshaling — this is the same code path Kolu has always
 * used, dressed in the `Host` interface.
 */

import { execFile } from "node:child_process";
import { watch } from "node:fs";
import { readFile as fsReadFile, stat as fsStat } from "node:fs/promises";
import type { Logger } from "../log.ts";
import { spawnPty } from "../pty.ts";
import type { ExecOpts, ExecResult, Host, SpawnPtyOpts } from "./types.ts";

/** Sentinel id used when `TerminalCreateInput.hostId` is undefined and on
 *  saved terminals that pre-date the field. Matches the `Location`
 *  discriminator in persisted sessions. */
export const LOCAL_HOST_ID = "local";

export function createLocalHost(): Host {
  return {
    id: LOCAL_HOST_ID,
    label: "Local",
    kind: "local",
    spawnPty: async (tlog: Logger, opts: SpawnPtyOpts) =>
      spawnPty(
        tlog,
        opts.terminalId,
        {
          onData: opts.onData,
          onExit: opts.onExit,
          onCwd: opts.onCwd,
          onTitleChange: opts.onTitleChange,
          onCommandRun: opts.onCommandRun,
        },
        opts.cwd,
      ),
    exec: (cmd: string, args: string[], opts: ExecOpts) =>
      new Promise<ExecResult>((resolve) => {
        execFile(
          cmd,
          args,
          {
            cwd: opts.cwd,
            timeout: opts.timeoutMs ?? 30_000,
            maxBuffer: opts.maxBytes ?? 1_048_576,
          },
          (err, stdout, stderr) => {
            const exitCode =
              err && "code" in err && typeof err.code === "number"
                ? err.code
                : err
                  ? null
                  : 0;
            resolve({
              // @types/node's `execFile` callback over-narrows the
              // stdout/stderr types when the options object lacks an
              // explicit `encoding`. Coerce defensively so the
              // controller doesn't have to special-case.
              stdout: String(stdout ?? ""),
              stderr: String(stderr ?? ""),
              exitCode,
            });
          },
        );
      }),
    watch: async (path, onChange, opts) => {
      const watcher = watch(
        path,
        { recursive: opts?.recursive ?? false, persistent: true },
        (_eventType, filename) => {
          onChange(filename ? filename.toString() : "");
        },
      );
      return {
        stop: () => {
          try {
            watcher.close();
          } catch {
            // ignore
          }
        },
      };
    },
    queryDb: async (path, sql, params) => {
      // Dynamic import — `node:sqlite` is "experimental" enough that
      // a top-level import in code paths that may never hit it would
      // be noisy for the kolu-server's main entrypoint.
      const sqlite = await import("node:sqlite");
      const db = new sqlite.DatabaseSync(path, { readOnly: true });
      try {
        const stmt = db.prepare(sql);
        return stmt.all(...(params ?? [])) as Array<Record<string, unknown>>;
      } finally {
        db.close();
      }
    },
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
    shutdown: async () => {
      // Local host has no long-lived connection to tear down.
    },
  };
}
