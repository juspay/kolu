/**
 * `LocalHost` — the default Host implementation. Wraps the existing
 * `spawnPty` (which uses `node-pty` directly) so the rest of the server
 * can treat local and remote terminals uniformly. No new process,
 * no SSH, no marshaling — this is the same code path Kolu has always
 * used, dressed in the `Host` interface.
 */

import { execFile } from "node:child_process";
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
    shutdown: async () => {
      // Local host has no long-lived connection to tear down.
    },
  };
}
